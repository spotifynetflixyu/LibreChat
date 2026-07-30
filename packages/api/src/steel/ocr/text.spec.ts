import { getPaddleOcrResultContent, getPaddleOcrResultError } from './text';

describe('PaddleOCR result text', () => {
  it('recognizes top-level error status', () => {
    expect(getPaddleOcrResultError({ status: 'error', content: 'provider failed' })).toBe(
      'provider failed',
    );
  });

  it('recognizes nested LangChain error status', () => {
    expect(
      getPaddleOcrResultError({ lc_kwargs: { status: 'error', content: 'provider failed' } }),
    ).toBe('provider failed');
  });

  it('recognizes exact standalone Error content', () => {
    expect(getPaddleOcrResultError({ status: 'success', content: 'Error' })).toBe('Error');
  });

  it('recognizes the observed Error calling tool wrapper', () => {
    expect(
      getPaddleOcrResultError({
        status: 'success',
        content: "Error calling tool 'paddleocr_vl'",
      }),
    ).toBe("Error calling tool 'paddleocr_vl'");
    expect(getPaddleOcrResultError({ content: 'ERROR CALLING TOOL paddleocr_vl' })).toBe(
      'ERROR CALLING TOOL paddleocr_vl',
    );
  });

  it('does not flag valid OCR content containing Error', () => {
    expect(getPaddleOcrResultError({ status: 'success', content: 'Error rate report' })).toBe(
      undefined,
    );
    expect(getPaddleOcrResultContent({ status: 'success', content: 'Error rate report' })).toBe(
      'Error rate report',
    );
  });

  it('ignores empty and unstructured results without an error status', () => {
    expect(getPaddleOcrResultError(undefined)).toBeUndefined();
    expect(getPaddleOcrResultError({ status: 'success' })).toBeUndefined();
    expect(getPaddleOcrResultError({ content: '' })).toBeUndefined();
    expect(getPaddleOcrResultError('OCR text')).toBeUndefined();
  });
});
