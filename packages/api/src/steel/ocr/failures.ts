import type { SteelRuntimeJsonObject } from '../runtime/context';

export type SteelOcrMissingPagesByFileKey = Record<string, number[]>;

function isPageIndex(value: SteelRuntimeJsonObject[string]): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function groupSteelOcrMissingPagesByFileKey(
  failures: readonly SteelRuntimeJsonObject[],
): SteelOcrMissingPagesByFileKey {
  const pagesByFileKey = new Map<string, Set<number>>();

  for (const failure of failures) {
    const { ocrFileKey, pageStart, pageEnd } = failure;
    if (
      typeof ocrFileKey !== 'string' ||
      ocrFileKey.length === 0 ||
      !isPageIndex(pageStart) ||
      !isPageIndex(pageEnd) ||
      pageStart > pageEnd
    ) {
      continue;
    }

    const pages = pagesByFileKey.get(ocrFileKey) ?? new Set<number>();
    for (let page = pageStart; page <= pageEnd; page += 1) {
      pages.add(page);
    }
    pagesByFileKey.set(ocrFileKey, pages);
  }

  return Object.fromEntries(
    [...pagesByFileKey.entries()].map(([fileKey, pages]) => [
      fileKey,
      [...pages].sort((left, right) => left - right),
    ]),
  );
}
