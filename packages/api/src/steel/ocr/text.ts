function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getNestedString(value: unknown, pathSegments: readonly string[]): string | undefined {
  let current = value;
  for (const segment of pathSegments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === 'string' && current.trim() !== '' ? current : undefined;
}

export function getPaddleOcrResultText(result: unknown): string | undefined {
  if (typeof result === 'string') {
    return result;
  }
  if (!isRecord(result)) {
    return undefined;
  }

  return (
    getNestedString(result, ['content']) ??
    getNestedString(result, ['text']) ??
    getNestedString(result, ['markdown']) ??
    getNestedString(result, ['lc_kwargs', 'content']) ??
    getNestedString(result, ['lc_kwargs', 'text']) ??
    getNestedString(result, ['lc_kwargs', 'markdown'])
  );
}

export function getPaddleOcrResultContent(result: unknown): string {
  const text = getPaddleOcrResultText(result);
  if (text !== undefined) {
    return text;
  }
  if (isRecord(result) || Array.isArray(result)) {
    return JSON.stringify(result);
  }
  return String(result ?? '');
}

export function getPaddleOcrResultError(result: unknown): string | undefined {
  if (!isRecord(result)) {
    if (typeof result !== 'string') {
      return undefined;
    }

    const content = result.trim();
    return /^error$/iu.test(content) || /^error calling tool(?:\b|$)/iu.test(content)
      ? result
      : undefined;
  }

  const topLevelStatus = result.status;
  const nestedStatus = getNestedString(result, ['lc_kwargs', 'status']);
  if (topLevelStatus === 'error' || nestedStatus === 'error') {
    return getPaddleOcrResultContent(result);
  }

  const content = getPaddleOcrResultText(result);
  if (content === undefined) {
    return undefined;
  }

  const trimmedContent = content.trim();
  return /^error$/iu.test(trimmedContent) || /^error calling tool(?:\b|$)/iu.test(trimmedContent)
    ? content
    : undefined;
}
