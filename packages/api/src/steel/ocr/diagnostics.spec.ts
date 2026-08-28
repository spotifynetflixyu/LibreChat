import {
  classifyPaddleOcrDiagnostic,
  isPaddleOcrDiagnosticCode,
  isPaddleOcrMcpServerName,
  PADDLE_OCR_MCP_SERVER_NAME,
} from './diagnostics';

describe('PaddleOCR diagnostics', () => {
  it('uses PaddleOCR as default server name and matches aliases case-insensitively', () => {
    expect(PADDLE_OCR_MCP_SERVER_NAME).toBe(process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME?.trim() || 'PaddleOCR');
    expect(isPaddleOcrMcpServerName(PADDLE_OCR_MCP_SERVER_NAME.toUpperCase())).toBe(true);
    expect(isPaddleOcrMcpServerName(`${PADDLE_OCR_MCP_SERVER_NAME}-other`)).toBe(false);
  });

  it.each([
    ['HTTP 401: invalid API key', 'ai_studio_auth'],
    ['HTTP 429 too many requests', 'ai_studio_rate_limited'],
    ['request timed out while polling', 'ai_studio_timeout'],
    ['HTTP 400 invalid request', 'ai_studio_invalid_request'],
    ['failed to parse JSON response', 'ai_studio_response_parse'],
    ['job failed during polling', 'ai_studio_job_failed'],
    ['service unavailable (503)', 'ai_studio_unavailable'],
    ['inference failed for model', 'ai_studio_inference'],
  ])('classifies %s', (stderr, code) => {
    expect(classifyPaddleOcrDiagnostic(stderr)).toBe(code);
  });

  it('fails closed without preserving stderr content', () => {
    const stderr = 'secret-token https://example.test/path traceback unknown failure';
    expect(classifyPaddleOcrDiagnostic(stderr)).toBeUndefined();
    expect(classifyPaddleOcrDiagnostic(stderr)).not.toEqual(stderr);
  });

  it('accepts only allowlisted diagnostic codes', () => {
    expect(isPaddleOcrDiagnosticCode('ai_studio_timeout')).toBe(true);
    expect(isPaddleOcrDiagnosticCode('secret-token')).toBe(false);
  });

  it.each([
    ['AuthenticationError: credentials rejected', 'ai_studio_auth'],
    ['ResourceUnavailableError: backend unavailable', 'ai_studio_unavailable'],
    ['ExecutionTimeoutError: inference timed out', 'ai_studio_timeout'],
    ['JobFailedError: remote job failed', 'ai_studio_job_failed'],
    ['ResponseFormatError: malformed response', 'ai_studio_response_parse'],
    ['ResultParseError: invalid JSON', 'ai_studio_response_parse'],
    ['APIError: model inference failed', 'ai_studio_inference'],
  ])('recognizes PaddleOCR exception class %s', (stderr, code) => {
    expect(classifyPaddleOcrDiagnostic(stderr)).toBe(code);
  });

  it('does not classify URL query credentials as authentication diagnostics', () => {
    const stderr =
      'download failed: https://s3.example.test/object?X-Amz-Credential=access-key%2Fscope';
    expect(classifyPaddleOcrDiagnostic(stderr)).toBeUndefined();
  });
});
