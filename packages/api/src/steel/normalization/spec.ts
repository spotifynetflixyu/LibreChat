export function normalizeSteelSpecKey(
  ...parts: Array<string | null | undefined>
): string | undefined {
  const normalized = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join('_')
    .normalize('NFKC')
    .replace(/[＊*×]/gu, 'x')
    .replace(/\s+/gu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  return normalized || undefined;
}

export function normalizeSteelSpecKeyOrUnknown(
  ...parts: Array<string | null | undefined>
): string {
  return normalizeSteelSpecKey(...parts) ?? 'unknown_spec';
}
