import { extractSteelDrawingEvidence, SteelDrawingEvidenceExtractionError } from './service';

import type { SteelDrawingEvidenceProvider, SteelDrawingEvidenceProviderResponse } from './service';

const imageFile = {
  filename: 'c.png',
  mediaType: 'image/png',
  data: new Uint8Array([1, 2, 3]),
};

function createProvider(
  response: SteelDrawingEvidenceProviderResponse = {
    provider: 'openai_oauth_responses',
    model: 'gpt-5.5',
    text: 'AI 判讀候選結果',
    unsupportedSettings: [],
    warnings: [],
  },
) {
  return jest.fn<
    ReturnType<SteelDrawingEvidenceProvider>,
    Parameters<SteelDrawingEvidenceProvider>
  >(async () => response);
}

describe('Steel drawing evidence extraction service', () => {
  it('sends DB-loaded OCR rules, user request, and original file parts to the provider', async () => {
    const provider = createProvider();

    const result = await extractSteelDrawingEvidence({
      model: 'gpt-5.5',
      files: [imageFile],
      userInstruction: '請判讀這張圖面有哪些資訊。',
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      provider,
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('DB_OCR_RULE_SENTINEL'),
          files: [imageFile],
        },
      ],
      workbookPatchTool: false,
      steelRuntimePolicy: false,
    });
    expect(provider.mock.calls[0]?.[0].messages[0]?.content).toContain(
      '請判讀這張圖面有哪些資訊。',
    );
    expect(result).toEqual({
      status: 'ok',
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'AI 判讀候選結果',
      warnings: [],
    });
  });

  it('requires reviewed OCR rules before calling the provider', async () => {
    const provider = createProvider();

    await expect(
      extractSteelDrawingEvidence({
        model: 'gpt-5.5',
        files: [imageFile],
        userInstruction: '讀圖',
        ocrAgentRuleInstruction: '',
        provider,
      }),
    ).rejects.toThrow('reviewed OCR agent rule instruction is required');
    expect(provider).not.toHaveBeenCalled();
  });

  it('uses original file parts again when rereading with previous analysis context', async () => {
    const provider = createProvider();

    await extractSteelDrawingEvidence({
      model: 'gpt-5.5',
      files: [imageFile],
      userInstruction: '重新判讀圖片',
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      previousAnalysisText: '上一輪把 PL7 看成 PL1',
      rereadOriginalFiles: true,
      provider,
    });

    const message = provider.mock.calls[0]?.[0].messages[0];
    expect(message?.files).toEqual([imageFile]);
    expect(message?.content).toContain('上一輪把 PL7 看成 PL1');
    expect(message?.content).toContain('重新判讀圖片');
  });

  it('returns a typed unsupported vision result without calling the provider', async () => {
    const provider = createProvider();

    const result = await extractSteelDrawingEvidence({
      model: 'gpt-5.5',
      files: [
        {
          filename: 'data.xlsx',
          mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: new Uint8Array([1]),
        },
      ],
      userInstruction: '讀附件',
      ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
      provider,
    });

    expect(provider).not.toHaveBeenCalled();
    expect(result.status).toBe('unsupported');
    expect(result.errorCategory).toBe('provider_vision_input_unsupported');
  });

  it('wraps provider failures as extraction errors without workbook mutation data', async () => {
    const provider = jest.fn<
      ReturnType<SteelDrawingEvidenceProvider>,
      Parameters<SteelDrawingEvidenceProvider>
    >(async () => {
      throw new Error('provider failed');
    });

    await expect(
      extractSteelDrawingEvidence({
        model: 'gpt-5.5',
        files: [imageFile],
        userInstruction: '讀圖',
        ocrAgentRuleInstruction: 'DB_OCR_RULE_SENTINEL',
        provider,
      }),
    ).rejects.toBeInstanceOf(SteelDrawingEvidenceExtractionError);
  });
});
