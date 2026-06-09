import type { SteelSemanticWorkbookPatch } from './semantic';

export interface WorkbookSubtotalMismatch {
  expectedTotal?: number;
  mismatchedFields: readonly string[];
  actualTotals: Record<string, number>;
  unknownSubtotalLineRefs?: readonly string[];
}

function toRoundedWorkbookAmount(value: number): number {
  return Number(value.toFixed(2));
}

export function getNumericWorkbookAmount(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? toRoundedWorkbookAmount(value) : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.includes('未確認')) {
    return undefined;
  }

  const numericText = normalized.replaceAll(',', '');
  if (!/^-?\d+(?:\.\d+)?$/.test(numericText)) {
    return undefined;
  }

  const amount = Number(numericText);
  return Number.isFinite(amount) ? toRoundedWorkbookAmount(amount) : undefined;
}

function getLineRef(line: SteelSemanticWorkbookPatch['quoteLines'][number], index: number): string {
  if (line.lineId) {
    return line.lineId;
  }

  if (typeof line.lineNo === 'number') {
    return `line_${line.lineNo}`;
  }

  return `line_${index + 1}`;
}

function getWorkbookSubtotalState(input: SteelSemanticWorkbookPatch): {
  expectedTotal: number | undefined;
  unknownSubtotalLineRefs: string[];
} {
  if (input.quoteLines.length === 0) {
    return { expectedTotal: undefined, unknownSubtotalLineRefs: [] };
  }

  let total = 0;
  const unknownSubtotalLineRefs: string[] = [];

  input.quoteLines.forEach((line, index) => {
    const subtotal = getNumericWorkbookAmount(line.subtotal);
    if (subtotal === undefined) {
      unknownSubtotalLineRefs.push(getLineRef(line, index));
      return;
    }

    total += subtotal;
  });

  if (unknownSubtotalLineRefs.length > 0) {
    return { expectedTotal: undefined, unknownSubtotalLineRefs };
  }

  return {
    expectedTotal: toRoundedWorkbookAmount(total),
    unknownSubtotalLineRefs,
  };
}

export function getWorkbookSubtotalMismatch(
  input: SteelSemanticWorkbookPatch,
): WorkbookSubtotalMismatch | undefined {
  const subtotalState = getWorkbookSubtotalState(input);
  const summaryTotals = [
    ['summary.totalAmount', getNumericWorkbookAmount(input.summary?.totalAmount)],
  ] as const;
  const actualTotals: Record<string, number> = {};
  const mismatchedFields: string[] = [];

  for (const [field, actualTotal] of summaryTotals) {
    if (actualTotal === undefined) {
      continue;
    }

    if (subtotalState.expectedTotal === undefined || actualTotal !== subtotalState.expectedTotal) {
      mismatchedFields.push(field);
      actualTotals[field] = actualTotal;
    }
  }

  if (mismatchedFields.length === 0) {
    return undefined;
  }

  return {
    ...(subtotalState.expectedTotal === undefined
      ? {}
      : { expectedTotal: subtotalState.expectedTotal }),
    mismatchedFields,
    actualTotals,
    ...(subtotalState.unknownSubtotalLineRefs.length === 0
      ? {}
      : { unknownSubtotalLineRefs: subtotalState.unknownSubtotalLineRefs }),
  };
}

export function getFirstWorkbookSubtotalMismatch(
  inputs: readonly SteelSemanticWorkbookPatch[],
): WorkbookSubtotalMismatch | undefined {
  for (const input of inputs) {
    const mismatch = getWorkbookSubtotalMismatch(input);
    if (mismatch !== undefined) {
      return mismatch;
    }
  }

  return undefined;
}
