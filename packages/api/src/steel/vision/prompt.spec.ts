import { buildDrawingEvidencePrompt } from './prompt';

describe('Steel drawing evidence prompt builder', () => {
  it('builds the prompt from DB-loaded OCR rules and the user request only', () => {
    const prompt = buildDrawingEvidencePrompt({
      ocrAgentRuleInstruction:
        'DB_OCR_RULE_SENTINEL 請先做局部裁切、方向確認、欄位對齊與視覺交叉檢查。',
      userInstruction: '請判讀這張圖面有哪些資訊。',
    });

    expect(prompt).toContain('DB_OCR_RULE_SENTINEL');
    expect(prompt).toContain('Reviewed OCR rules loaded from steel.agent_rules');
    expect(prompt).toContain('請判讀這張圖面有哪些資訊。');
  });

  it('requires reviewed OCR rules to be provided by the caller', () => {
    expect(() =>
      buildDrawingEvidencePrompt({
        ocrAgentRuleInstruction: '',
        userInstruction: '讀圖',
      }),
    ).toThrow('reviewed OCR agent rule instruction is required');
  });

  it('does not prescribe fixed extraction fields', () => {
    const prompt = buildDrawingEvidencePrompt({
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      userInstruction: '讀圖',
    });

    expect(prompt).not.toContain('必須輸出欄位：名稱、件號、規格、數量');
    expect(prompt).not.toContain('steelDrawingEvidenceResultSchema');
    expect(prompt).not.toContain('fixed structured result');
  });

  it('does not duplicate OCR strategy owned by the DB rule body', () => {
    const prompt = buildDrawingEvidencePrompt({
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      userInstruction: '讀圖',
    });

    expect(prompt).not.toContain('局部區域');
    expect(prompt).not.toContain('表格線');
    expect(prompt).not.toContain('欄位對齊');
    expect(prompt).not.toContain('視覺交叉檢查');
    expect(prompt).not.toContain('公式不一致');
  });

  it('does not duplicate output or quote-boundary policy owned by DB rules/provider context', () => {
    const prompt = buildDrawingEvidencePrompt({
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      userInstruction: '讀圖',
    });

    expect(prompt).not.toContain('file_analysis_data');
    expect(prompt).not.toContain('manual_review');
    expect(prompt).not.toContain('interpretation_notes');
    expect(prompt).not.toContain('quote evidence');
    expect(prompt).not.toContain('Admin source');
    expect(prompt).not.toContain('fileId=');
    expect(prompt).not.toContain('mediaType=');
  });
});
