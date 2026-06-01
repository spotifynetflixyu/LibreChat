import type { SteelToolJsonObject, SteelToolJsonValue } from './results';

export const steelToolRedactionVersion = 1;

const maxStringLength = 1200;
const maxArrayItems = 20;
const maxDepth = 8;

const instructionLikePatterns = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /system\s+prompt/gi,
  /developer\s+message/gi,
  /reveal\s+(the\s+)?prompt/gi,
];

function sanitizeString(value: string): string {
  const redacted = instructionLikePatterns.reduce(
    (text, pattern) => text.replace(pattern, '[redacted instruction-like text]'),
    value,
  );

  if (redacted.length <= maxStringLength) {
    return redacted;
  }

  return `${redacted.slice(0, maxStringLength)}...[truncated]`;
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown, depth: number): SteelToolJsonValue | undefined {
  if (depth > maxDepth) {
    return '[truncated]';
  }

  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((entry) => sanitizeValue(entry, depth + 1))
      .filter((entry): entry is SteelToolJsonValue => entry !== undefined);
  }

  if (!isPlainObject(value)) {
    return sanitizeString(String(value));
  }

  return Object.entries(value).reduce<SteelToolJsonObject>((sanitized, [key, entry]) => {
    const sanitizedEntry = sanitizeValue(entry, depth + 1);

    if (sanitizedEntry !== undefined) {
      sanitized[key] = sanitizedEntry;
    }

    return sanitized;
  }, {});
}

export function sanitizeSteelToolOutput(value: unknown): SteelToolJsonObject {
  const sanitized = sanitizeValue(value, 0);

  if (!isPlainObject(sanitized)) {
    return { value: sanitized ?? null };
  }

  return sanitized;
}
