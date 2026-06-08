import {
  getFirstWorkbookSubtotalMismatch,
  getNumericWorkbookAmount,
  getWorkbookSubtotalMismatch,
} from './subtotals';

import type { SteelSemanticWorkbookPatch } from './semantic';

describe('Steel workbook subtotal validator', () => {
  it('parses finite numeric workbook amounts and rejects unknown values', () => {
    expect(getNumericWorkbookAmount(624.125)).toBe(624.13);
    expect(getNumericWorkbookAmount('1,234.5')).toBe(1234.5);
    expect(getNumericWorkbookAmount('未確認')).toBeUndefined();
    expect(getNumericWorkbookAmount('NT$624')).toBeUndefined();
    expect(getNumericWorkbookAmount(Number.NaN)).toBeUndefined();
  });

  it('accepts matching numeric summary totals', () => {
    const patch: SteelSemanticWorkbookPatch = {
      quoteLines: [
        { lineId: 'line_1', subtotal: 100 },
        { lineId: 'line_2', subtotal: '524' },
      ],
      summary: {
        totalAmount: '624',
        confirmedAmount: 624,
      },
    };

    expect(getWorkbookSubtotalMismatch(patch)).toBeUndefined();
  });

  it('returns mismatched summary total fields when line subtotal sum differs', () => {
    const patch: SteelSemanticWorkbookPatch = {
      quoteLines: [{ lineId: 'line_1', subtotal: 624 }],
      summary: {
        totalAmount: 625,
        confirmedAmount: '625',
      },
    };

    expect(getWorkbookSubtotalMismatch(patch)).toEqual({
      expectedTotal: 624,
      mismatchedFields: ['summary.totalAmount', 'summary.confirmedAmount'],
      actualTotals: {
        'summary.totalAmount': 625,
        'summary.confirmedAmount': 625,
      },
    });
  });

  it('rejects confirmed summary totals when any line subtotal is unknown', () => {
    const patch: SteelSemanticWorkbookPatch = {
      quoteLines: [
        { lineId: 'line_1', subtotal: '未確認' },
        { lineId: 'line_2', subtotal: 100 },
      ],
      summary: {
        totalAmount: 100,
        confirmedAmount: 100,
      },
    };

    expect(getWorkbookSubtotalMismatch(patch)).toEqual({
      mismatchedFields: ['summary.totalAmount', 'summary.confirmedAmount'],
      actualTotals: {
        'summary.totalAmount': 100,
        'summary.confirmedAmount': 100,
      },
      unknownSubtotalLineRefs: ['line_1'],
    });
  });

  it('allows unknown line subtotals when summary totals stay unconfirmed', () => {
    const patch: SteelSemanticWorkbookPatch = {
      quoteLines: [{ lineNo: 1, subtotal: '未確認' }],
      summary: {
        totalAmount: '未確認',
        confirmedAmount: '未確認',
      },
    };

    expect(getWorkbookSubtotalMismatch(patch)).toBeUndefined();
  });

  it('returns the first mismatch across parsed workbook patch inputs', () => {
    const validPatch: SteelSemanticWorkbookPatch = {
      quoteLines: [{ lineId: 'line_1', subtotal: 100 }],
      summary: { totalAmount: 100 },
    };
    const invalidPatch: SteelSemanticWorkbookPatch = {
      quoteLines: [{ lineId: 'line_2', subtotal: 200 }],
      summary: { totalAmount: 201 },
    };

    expect(getFirstWorkbookSubtotalMismatch([validPatch, invalidPatch])).toEqual({
      expectedTotal: 200,
      mismatchedFields: ['summary.totalAmount'],
      actualTotals: {
        'summary.totalAmount': 201,
      },
    });
  });
});
