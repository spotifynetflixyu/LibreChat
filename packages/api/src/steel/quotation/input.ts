import type { SteelQuotationOcrSelection } from '@librechat/data-schemas';
import type { SteelQuotationOcrSource } from 'librechat-data-provider';

export class SteelQuotationInputError extends Error {
  constructor(public readonly code: 'invalid_snapshot' | 'concurrent_change') {
    super('Quotation OCR input is unavailable or changed');
    this.name = 'SteelQuotationInputError';
  }
}

export function sameQuotationOcrSelection(
  left: SteelQuotationOcrSelection | undefined,
  right: SteelQuotationOcrSelection | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function sameQuotationOcrSource(
  left: SteelQuotationOcrSelection | undefined,
  right: SteelQuotationOcrSelection | undefined,
): boolean {
  return JSON.stringify(left?.selected ?? null) === JSON.stringify(right?.selected ?? null);
}

export function quotationOcrSource(
  selection: SteelQuotationOcrSelection | undefined,
): SteelQuotationOcrSource | undefined {
  if (!selection) return undefined;
  const { selected, candidates, version } = selection;
  return {
    source: selected.source,
    version,
    savedAt: new Date(selected.savedAt).toISOString(),
    messageId: selected.messageId,
    outputId: selected.outputId,
    title: selected.title,
    revision: selected.revision,
    ...(candidates.ai ? { aiSavedAt: new Date(candidates.ai.savedAt).toISOString() } : {}),
    ...(candidates.human ? { humanSavedAt: new Date(candidates.human.savedAt).toISOString() } : {}),
  };
}
