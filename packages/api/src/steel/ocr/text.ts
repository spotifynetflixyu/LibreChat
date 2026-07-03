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
