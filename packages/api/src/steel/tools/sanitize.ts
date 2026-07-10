import type { SteelToolJsonObject, SteelToolJsonValue } from './results';

export const steelToolRedactionVersion = 1;

const instructionLikePatterns = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /system\s+prompt/gi,
  /developer\s+message/gi,
  /reveal\s+(the\s+)?prompt/gi,
];

function sanitizeString(value: string): string {
  return instructionLikePatterns.reduce(
    (text, pattern) => text.replace(pattern, '[redacted instruction-like text]'),
    value,
  );
}

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRawPriceRatioKey(key: string): boolean {
  return (
    key === 'tierRatios' ||
    key === 'priceRatios' ||
    /^priceRatio[A-F]$/u.test(key) ||
    /^price_ratio_[a-f]$/u.test(key)
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): SteelToolJsonValue | undefined {
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
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const output = value
      .map((entry) => sanitizeValue(entry, seen))
      .filter((entry): entry is SteelToolJsonValue => entry !== undefined);
    seen.delete(value);
    return output;
  }

  if (!isPlainObject(value)) {
    return sanitizeString(String(value));
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  const output = Object.entries(value).reduce<SteelToolJsonObject>((sanitized, [key, entry]) => {
    if (isRawPriceRatioKey(key)) {
      return sanitized;
    }

    const sanitizedEntry = sanitizeValue(entry, seen);

    if (sanitizedEntry !== undefined) {
      sanitized[key] = sanitizedEntry;
    }

    return sanitized;
  }, {});
  seen.delete(value);
  return output;
}

export function sanitizeSteelToolOutput(value: unknown): SteelToolJsonObject {
  const sanitized = sanitizeValue(value, new WeakSet<object>());

  if (!isPlainObject(sanitized)) {
    return { value: sanitized ?? null };
  }

  return sanitized;
}
