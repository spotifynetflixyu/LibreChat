import { groupSteelOcrMissingPageRangesByFileKey } from './failures';

describe('groupSteelOcrMissingPageRangesByFileKey', () => {
  it('merges overlapping and adjacent ranges without enumerating every page', () => {
    expect(
      groupSteelOcrMissingPageRangesByFileKey([
        { ocrFileKey: 'file:a', pageStart: 1, pageEnd: 50 },
        { ocrFileKey: 'file:a', pageStart: 45, pageEnd: 75 },
        { ocrFileKey: 'file:a', pageStart: 76, pageEnd: 90 },
        { ocrFileKey: 'file:a', pageStart: 101, pageEnd: 120 },
        { ocrFileKey: 'file:a', pageStart: 100, pageEnd: 100 },
        { ocrFileKey: 'file:b', pageStart: 8, pageEnd: 8 },
        { ocrFileKey: 'file:b', pageStart: 4, pageEnd: 5 },
      ]),
    ).toEqual({
      'file:a': [
        { pageStart: 1, pageEnd: 90 },
        { pageStart: 100, pageEnd: 120 },
      ],
      'file:b': [
        { pageStart: 4, pageEnd: 5 },
        { pageStart: 8, pageEnd: 8 },
      ],
    });
  });

  it('ignores missing, non-integer, non-positive, and reversed page bounds', () => {
    expect(
      groupSteelOcrMissingPageRangesByFileKey([
        { ocrFileKey: 'file:missing', pageStart: 1 },
        { ocrFileKey: 'file:fractional', pageStart: 1.5, pageEnd: 2 },
        { ocrFileKey: 'file:negative', pageStart: -1, pageEnd: 2 },
        { ocrFileKey: 'file:reversed', pageStart: 5, pageEnd: 4 },
        { ocrFileKey: '', pageStart: 1, pageEnd: 2 },
      ]),
    ).toEqual({});
  });
});
