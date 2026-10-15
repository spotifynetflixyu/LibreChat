import {
  sanitizeSteelErrorMessage,
  parseSteelNativeActivityEvent,
  isFailedSteelPreflightOutput,
  parseSteelNativePreflightToolCall,
} from './events';

const paddleArgs = {
  output_mode: 'detailed',
  return_images: false,
  use_doc_orientation_classify: true,
  use_doc_unwarping: true,
  use_layout_detection: true,
};

const paddleIdentity = {
  ocrEngine: 'paddleocr_vl',
  ocrFileKey: 'file:pdf-1',
  filename: 'quote.pdf',
  chunkIndex: 0,
  chunkCount: 1,
  pageStart: 1,
  pageEnd: 2,
  dataSizeBytes: 10,
};

describe('Steel native activity events', () => {
  it('strips unknown fields and sanitizes error messages', () => {
    expect(
      parseSteelNativeActivityEvent({
        type: 'delegate_ocr_status',
        source: 'delegate_ocr_preflight',
        delegateOcrIndex: 1,
        stage: 'paddleocr',
        status: 'failed',
        message: 'Delegate OCR failed',
        errorMessage: 'failed https://signed.example.test/?token=secret',
        claimToken: 'claim-1',
      }),
    ).toEqual({
      type: 'delegate_ocr_status',
      source: 'delegate_ocr_preflight',
      delegateOcrIndex: 1,
      stage: 'paddleocr',
      status: 'failed',
      message: 'Delegate OCR failed',
      errorMessage: 'failed [redacted-url]',
    });
  });

  it('enforces quotation progress, repair bounds and repair chunk identity', () => {
    const event = {
      type: 'quotation_status',
      source: 'quotation_preflight',
      conversationId: 'conversation-1',
      index: 0,
      stage: 'chunk_repair_started',
      status: 'running',
      completedChunks: 1,
      totalChunks: 2,
      chunkIndex: 1,
      repairAttempt: 1,
      maxRepairAttempts: 2,
    };
    expect(parseSteelNativeActivityEvent(event)).toEqual(event);
    expect(parseSteelNativeActivityEvent({ ...event, completedChunks: 3 })).toBeUndefined();
    expect(parseSteelNativeActivityEvent({ ...event, repairAttempt: 3 })).toBeUndefined();
    expect(parseSteelNativeActivityEvent({ ...event, chunkIndex: undefined })).toBeUndefined();
  });

  it('rejects sources and types outside the current contract', () => {
    const event = {
      type: 'parse_status',
      source: 'tool_result',
      message: 'Saved',
      parseStatus: 'saved',
    };
    expect(parseSteelNativeActivityEvent(event)).toEqual(event);
    expect(
      parseSteelNativeActivityEvent({ ...event, source: 'assistant_markdown' }),
    ).toBeUndefined();
    expect(parseSteelNativeActivityEvent({ ...event, type: 'unknown' })).toBeUndefined();
  });

  it('removes control characters and bounds sanitized text', () => {
    const sanitized = sanitizeSteelErrorMessage(`bad\u0000\u2028${'x'.repeat(600)}`);
    expect(sanitized?.startsWith('bad x')).toBe(true);
    expect(sanitized).toHaveLength(512);
    expect(sanitizeSteelErrorMessage('   ')).toBeUndefined();
  });
});

describe('Steel native preflight tool calls', () => {
  it('canonicalizes compact PaddleOCR outputs and flags failures', () => {
    const failure = {
      status: 'fail',
      paddleocr: 'fail',
      ...paddleIdentity,
      attemptsUsed: 2,
      errorCode: 'ai_studio_timeout',
      error: 'failed https://signed.example.test/?token=secret',
      errorMessage: 'failed https://signed.example.test/?token=secret',
    };
    const card = parseSteelNativePreflightToolCall({
      type: 'tool_call',
      id: 'paddle-1',
      name: 'paddleocr_vl---PaddleOCR',
      args: paddleArgs,
      output: JSON.stringify(failure),
      progress: 1,
    });
    expect(JSON.parse(card?.output ?? '{}')).toEqual({
      ...failure,
      error: 'failed [redacted-url]',
      errorMessage: 'failed [redacted-url]',
    });
    expect(isFailedSteelPreflightOutput(card?.output ?? '')).toBe(true);
  });

  it('rejects legacy PaddleOCR outputs and mismatched argument shapes', () => {
    const base = { type: 'tool_call', id: 'paddle-1', name: 'paddleocr_vl', progress: 0 };
    expect(parseSteelNativePreflightToolCall({ ...base, args: paddleArgs })).toBeDefined();
    expect(
      parseSteelNativePreflightToolCall({ ...base, args: paddleArgs, output: 'Error: failed' }),
    ).toBeUndefined();
    expect(
      parseSteelNativePreflightToolCall({
        ...base,
        args: paddleArgs,
        output: JSON.stringify({ ...paddleIdentity, status: 'completed', rawTextLength: 10 }),
      }),
    ).toBeUndefined();
    expect(
      parseSteelNativePreflightToolCall({ ...base, args: { queries: [{ keyword: 'plate' }] } }),
    ).toBeUndefined();
  });

  it('keeps price-search outputs verbatim and requires JSON query values', () => {
    const output = JSON.stringify({
      toolName: 'search_price_candidates',
      ok: false,
      errorCategory: 'x',
      errorSummary: 'y',
    });
    const card = {
      type: 'tool_call',
      id: 'price-1',
      name: 'steel_search_price_candidates',
      args: { queries: [{ nested: { values: [1, null, true] } }] },
      output,
      progress: 1,
    };
    expect(parseSteelNativePreflightToolCall(card)).toEqual(card);
    expect(isFailedSteelPreflightOutput(output)).toBe(true);
    expect(
      parseSteelNativePreflightToolCall({
        ...card,
        args: { queries: [{ nested: { value: Symbol('not-json') } }] },
      }),
    ).toBeUndefined();
  });
});
