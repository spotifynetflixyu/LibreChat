const toolErrorMaxLength = 1_024;
const toolErrorMessageMaxLength = 512;
const toolErrorCodeMaxLength = 128;
const secretFieldPattern =
  /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|credential|password|secret|signature|sig|token|key)$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
}

function redactStructuredSecrets(value: string): string {
  try {
    const visit = (current: unknown): unknown => {
      if (Array.isArray(current)) {
        return current.map(visit);
      }
      if (!isRecord(current)) {
        return current;
      }
      return Object.fromEntries(
        Object.entries(current).map(([key, entry]) => [
          key,
          secretFieldPattern.test(key) ? '[REDACTED]' : visit(entry),
        ]),
      );
    };
    return JSON.stringify(visit(JSON.parse(value) as unknown));
  } catch {
    return value;
  }
}

function sanitizeErrorText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = redactStructuredSecrets(value)
    .replace(/https?:\/\/[^\s<>"'`]+/giu, '[redacted-url]')
    .replace(
      /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|authorization|credential|password|secret|signature|sig|token|key)\s*[:=]\s*[^\s&;,]+/giu,
      (match) => `${match.slice(0, match.search(/[:=]/u) + 1)}[REDACTED]`,
    )
    .replace(/\bBearer\s+[^\s"'`]+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]+/giu, 'sk-[REDACTED]')
    .split('')
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029
        ? ' '
        : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) {
    return undefined;
  }
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 3)}...`;
}

function parseResult(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '');
}

function hasFailureResult(
  toolCall: Record<string, unknown>,
  result: string,
  parsed: Record<string, unknown> | undefined,
): boolean {
  if (
    toolCall.runStepStatus === 'failed' ||
    toolCall.runStepStatus === 'cancelled' ||
    toolCall.inputValidationError === true ||
    /^Error:/iu.test(result) ||
    result.startsWith('Error processing tool')
  ) {
    return true;
  }
  if (!parsed) {
    return false;
  }
  const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
  if (['error', 'failed', 'fail', 'cancelled'].includes(status)) {
    return true;
  }
  if (parsed.success === false || parsed.isError === true) {
    return true;
  }
  const error = parsed.error;
  return (
    (typeof error === 'string' && error.trim() !== '') ||
    (isRecord(error) && Object.keys(error).length > 0)
  );
}

function isCompactResult(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  if (
    value.status === 'ok' &&
    Number.isSafeInteger(value.dataSizeBytes) &&
    (value.dataSizeBytes as number) >= 0
  ) {
    return keys.join(',') === 'dataSizeBytes,status';
  }
  if (
    value.status !== 'fail' ||
    !Number.isSafeInteger(value.dataSizeBytes) ||
    (value.dataSizeBytes as number) < 0
  ) {
    return false;
  }
  return keys.every((key) =>
    ['dataSizeBytes', 'error', 'errorCode', 'errorMessage', 'status'].includes(key),
  );
}

function getErrorCode(
  toolCall: Record<string, unknown>,
  parsed: Record<string, unknown> | undefined,
  error: Record<string, unknown> | undefined,
  result: string,
): string | undefined {
  const explicit = firstString(
    parsed?.errorCode,
    error?.errorCode,
    error?.code,
    parsed?.code,
    typeof parsed?.statusCode === 'number' ? String(parsed.statusCode) : undefined,
  );
  const matched = result.match(
    /\b(?:error[_ -]?code|code)\s*[:=]\s*["']?([A-Za-z0-9_.:-]{1,128})/iu,
  )?.[1];
  let fallback: string | undefined;
  if (toolCall.runStepStatus === 'cancelled') {
    fallback = 'cancelled';
  } else if (toolCall.inputValidationError === true) {
    fallback = 'input_validation_error';
  }
  return sanitizeErrorText(explicit ?? matched ?? fallback, toolErrorCodeMaxLength);
}

export function compactToolCallOutput(
  output: unknown,
  toolCall: Record<string, unknown> = {},
): string {
  const result = serializeResult(output);
  const parsed = parseResult(result);
  if (parsed && isCompactResult(parsed)) {
    if (parsed.status === 'ok') {
      return result;
    }
    const error = sanitizeErrorText(parsed.error, toolErrorMaxLength) ?? 'Tool call failed';
    const errorMessage = sanitizeErrorText(parsed.errorMessage, toolErrorMessageMaxLength) ?? error;
    const errorCode = sanitizeErrorText(parsed.errorCode, toolErrorCodeMaxLength);
    return JSON.stringify({
      status: 'fail',
      dataSizeBytes: parsed.dataSizeBytes,
      error,
      errorMessage,
      ...(errorCode ? { errorCode } : {}),
    });
  }
  const dataSizeBytes = Buffer.byteLength(result, 'utf8');
  if (!hasFailureResult(toolCall, result, parsed)) {
    return JSON.stringify({ status: 'ok', dataSizeBytes });
  }

  const parsedError = isRecord(parsed?.error) ? parsed.error : undefined;
  const rawMessage = firstString(
    parsed?.errorMessage,
    parsedError?.errorMessage,
    parsedError?.message,
    parsed?.message,
    typeof parsed?.error === 'string' ? parsed.error : undefined,
    result,
  );
  const error = sanitizeErrorText(result, toolErrorMaxLength) ?? 'Tool call failed';
  const errorMessage =
    sanitizeErrorText(rawMessage, toolErrorMessageMaxLength) ?? 'Tool call failed';
  const errorCode = getErrorCode(toolCall, parsed, parsedError, result);
  return JSON.stringify({
    status: 'fail',
    dataSizeBytes,
    error,
    errorMessage,
    ...(errorCode ? { errorCode } : {}),
  });
}

export function compactToolCallResults(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((part) => {
    if (!isRecord(part) || part.type !== 'tool_call' || !isRecord(part.tool_call)) {
      return part;
    }
    const toolCall = part.tool_call;
    if (toolCall.output === undefined) {
      return part;
    }
    return {
      ...part,
      tool_call: {
        ...toolCall,
        output: compactToolCallOutput(toolCall.output, toolCall),
      },
    };
  });
}

export function compactMessageToolResults<T extends Record<string, unknown>>(message: T): T {
  if (!Array.isArray(message.content)) {
    return message;
  }
  return { ...message, content: compactToolCallResults(message.content) };
}
