const invalidCredentials = new Set<string>();

function getCredentialKey(authFilePath?: string): string {
  return authFilePath?.trim() || 'default';
}

export function clearOpenAIOAuthCredentialInvalid(authFilePath?: string): void {
  invalidCredentials.delete(getCredentialKey(authFilePath));
}

export function isOpenAIOAuthCredentialInvalid(authFilePath?: string): boolean {
  return invalidCredentials.has(getCredentialKey(authFilePath));
}

export function markOpenAIOAuthCredentialInvalid(authFilePath?: string): void {
  invalidCredentials.add(getCredentialKey(authFilePath));
}

export function isOpenAIOAuthUnauthorizedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return false;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  return /\b401\b|unauthoriz|invalid_grant|refresh token.{0,40}(?:invalid|expired|revoked)/iu.test(
    message,
  );
}
