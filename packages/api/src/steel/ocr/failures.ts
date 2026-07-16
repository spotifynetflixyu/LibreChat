import type { SteelRuntimeJsonObject } from '../runtime/context';

export interface SteelOcrMissingPageRange {
  pageStart: number;
  pageEnd: number;
}

export type SteelOcrMissingPageRangesByFileKey = Record<string, SteelOcrMissingPageRange[]>;

function isPageIndex(value: SteelRuntimeJsonObject[string]): value is number {
  return Number.isSafeInteger(value) && value > 0;
}

function mergeRanges(ranges: readonly SteelOcrMissingPageRange[]): SteelOcrMissingPageRange[] {
  const sortedRanges = [...ranges].sort(
    (left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd,
  );
  const mergedRanges: SteelOcrMissingPageRange[] = [];

  for (const range of sortedRanges) {
    const previousRange = mergedRanges[mergedRanges.length - 1];
    if (previousRange && range.pageStart <= previousRange.pageEnd + 1) {
      previousRange.pageEnd = Math.max(previousRange.pageEnd, range.pageEnd);
      continue;
    }
    mergedRanges.push({ ...range });
  }

  return mergedRanges;
}

export function groupSteelOcrMissingPageRangesByFileKey(
  failures: readonly SteelRuntimeJsonObject[],
): SteelOcrMissingPageRangesByFileKey {
  const rangesByFileKey = new Map<string, SteelOcrMissingPageRange[]>();

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

    const ranges = rangesByFileKey.get(ocrFileKey) ?? [];
    ranges.push({ pageStart, pageEnd });
    rangesByFileKey.set(ocrFileKey, ranges);
  }

  return Object.fromEntries(
    [...rangesByFileKey.entries()].map(([fileKey, ranges]) => [fileKey, mergeRanges(ranges)]),
  );
}
