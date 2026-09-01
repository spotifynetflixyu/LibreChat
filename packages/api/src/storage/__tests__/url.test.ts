import { isExpiredSignedUrlError } from '../url';

describe('isExpiredSignedUrlError', () => {
  it.each([
    'RequestExpired',
    'SignatureDoesNotMatch',
    'ExpiredToken',
    'The request has expired',
    'presigned URL has expired',
    'X-Amz-Expires has passed for this signed URL',
  ])('recognizes explicit signed URL expiry signal: %s', (message) => {
    expect(isExpiredSignedUrlError(new Error(message))).toBe(true);
  });

  it('traverses nested causes and response/data fields without looping on cycles', () => {
    const error = new Error('request failed');
    const response: { status: number; data: { code: string; cause?: unknown } } = {
      status: 403,
      data: { code: 'RequestExpired' },
    };
    error.cause = { response };
    response.data.cause = error;

    expect(isExpiredSignedUrlError(error)).toBe(true);
  });

  it('traverses error arrays nested in response payloads', () => {
    expect(
      isExpiredSignedUrlError({ response: { data: { errors: [{ code: 'ExpiredToken' }] } } }),
    ).toBe(true);
  });

  it.each([
    new Error('401 Unauthorized'),
    { status: 403, message: 'authentication failed' },
    { response: { status: 401, data: { error: 'invalid credentials' } } },
    'signature verification failed',
    new Error('JWT signature expired'),
  ])('rejects generic auth failures: %p', (error) => {
    expect(isExpiredSignedUrlError(error)).toBe(false);
  });

  it.each([
    { status: 403, message: 'signed URL has expired' },
    { response: { statusCode: 401, data: { message: 'presigned URL expired' } } },
  ])('accepts auth status when paired with signed URL expiry context: %p', (error) => {
    expect(isExpiredSignedUrlError(error)).toBe(true);
  });

  it('ignores an unrelated valid signed URL carried by a network error', () => {
    expect(
      isExpiredSignedUrlError({
        message: 'network connection failed',
        config: { url: 'https://s3.example/object?X-Amz-Expires=1' },
      }),
    ).toBe(false);
  });
});
