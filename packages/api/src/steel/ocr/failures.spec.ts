import { groupSteelOcrMissingPagesByFileKey } from './failures';

describe('groupSteelOcrMissingPagesByFileKey', () => {
  it('expands, sorts, and deduplicates missing pages by file key', () => {
    expect(
      groupSteelOcrMissingPagesByFileKey([
        { ocrFileKey: 'file:b', pageStart: 4, pageEnd: 5 },
        { ocrFileKey: 'file:a', pageStart: 1, pageEnd: 2 },
        { ocrFileKey: 'file:a', pageStart: 2, pageEnd: 4 },
        { ocrFileKey: 'file:b', pageStart: 8, pageEnd: 8 },
        { ocrFileKey: 'file:unknown' },
      ]),
    ).toEqual({
      'file:b': [4, 5, 8],
      'file:a': [1, 2, 3, 4],
    });
  });

  it('ignores missing, non-integer, non-positive, and reversed page bounds', () => {
    expect(
      groupSteelOcrMissingPagesByFileKey([
        { ocrFileKey: 'file:missing', pageStart: 1 },
        { ocrFileKey: 'file:fractional', pageStart: 1.5, pageEnd: 2 },
        { ocrFileKey: 'file:negative', pageStart: -1, pageEnd: 2 },
        { ocrFileKey: 'file:reversed', pageStart: 5, pageEnd: 4 },
      ]),
    ).toEqual({});
  });
});
