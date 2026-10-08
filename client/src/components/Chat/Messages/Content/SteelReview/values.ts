import { normalizeSteelDecimal } from 'librechat-data-provider';
import type { SteelReviewKind } from 'librechat-data-provider';

const systemNumericHeaders = new Set([
  '數量', '單重', '總數', '單價', '厚度', '寬度', '長度', '肚', '計價基準',
]);
const ocrNumericHeaders = new Set(['數量', '厚度', '寬度', '長度']);

export function displaySteelReviewValue(
  kind: SteelReviewKind,
  header: string,
  value: string | null | undefined,
): string {
  const text = value ?? '';
  const numericHeaders = kind === 'system_order' ? systemNumericHeaders : ocrNumericHeaders;
  return numericHeaders.has(header)
    ? normalizeSteelDecimal(text) ?? text
    : text;
}
