import { groupSteelOcrMissingPageRangesByFileKey } from './failures';

describe('groupSteelOcrMissingPageRangesByFileKey', () => {
  it('merges overlapping and adjacent ranges without enumerating every page', () => {
    expect(
      groupSteelOcrMissingPageRangesByFileKey([
        { ocrFileKey: 'file:a', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 1, pageEnd: 50 },
        { ocrFileKey: 'file:a', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 45, pageEnd: 75 },
        { ocrFileKey: 'file:a', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 76, pageEnd: 90 },
        { ocrFileKey: 'file:a', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 101, pageEnd: 120 },
        { ocrFileKey: 'file:a', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 100, pageEnd: 100 },
        { ocrFileKey: 'file:b', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 8, pageEnd: 8 },
        { ocrFileKey: 'file:b', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 4, pageEnd: 5 },
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
        { ocrFileKey: 'file:missing', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 1 },
        { ocrFileKey: 'file:fractional', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 1.5, pageEnd: 2 },
        { ocrFileKey: 'file:negative', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: -1, pageEnd: 2 },
        { ocrFileKey: 'file:reversed', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 5, pageEnd: 4 },
        { ocrFileKey: '', mediaType: 'application/pdf', stage: 'paddleocr', pageStart: 1, pageEnd: 2 },
      ]),
    ).toEqual({});
  });

  it('ignores image and non-PaddleOCR failures', () => {
    expect(
      groupSteelOcrMissingPageRangesByFileKey([
        {
          ocrFileKey: 'file:image',
          mediaType: 'image/jpeg',
          stage: 'paddleocr',
          pageStart: 1,
          pageEnd: 1,
        },
        {
          ocrFileKey: 'file:organizer',
          mediaType: 'application/pdf',
          stage: 'organizer',
          pageStart: 2,
          pageEnd: 3,
        },
        {
          ocrFileKey: 'file:unknown-stage',
          mediaType: 'application/pdf',
          pageStart: 4,
          pageEnd: 5,
        },
      ]),
    ).toEqual({});
  });
});
