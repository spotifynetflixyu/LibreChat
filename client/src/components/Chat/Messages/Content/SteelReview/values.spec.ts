import { displaySteelReviewValue } from './values';

it.each(['數量', '單重', '總數', '單價', '厚度', '寬度', '長度', '肚', '計價基準'])(
  'normalizes the fixed system_order numeric column %s',
  (header) => {
    expect(displaySteelReviewValue('system_order', header, '15.000000')).toBe('15');
    expect(displaySteelReviewValue('system_order', header, '12.340000')).toBe('12.34');
    expect(displaySteelReviewValue('system_order', header, '0.000000')).toBe('0');
    expect(displaySteelReviewValue('system_order', header, '9007199254740993.123400')).toBe('9007199254740993.1234');
  },
);

it.each(['數量', '厚度', '寬度', '長度'])(
  'normalizes the fixed ocr_result numeric column %s',
  (header) => expect(displaySteelReviewValue('ocr_result', header, '15.000000')).toBe('15'),
);

it.each(['型號', '材質編號', '公式編號', '零件編號', '備註', '自訂數值'])(
  'preserves the text or flexible column %s',
  (header) => {
    expect(displaySteelReviewValue('system_order', header, '0015.0000')).toBe('0015.0000');
    expect(displaySteelReviewValue('ocr_result', header, '0015.0000')).toBe('0015.0000');
  },
);

it('preserves flexible OCR columns even when they share system_order numeric names', () => {
  for (const header of ['單重', '總數', '單價', '肚', '計價基準']) {
    expect(displaySteelReviewValue('ocr_result', header, '15.000000')).toBe('15.000000');
  }
});

it('keeps absent, unit-bearing and ambiguous values intact', () => {
  expect(displaySteelReviewValue('system_order', '厚度', null)).toBe('');
  expect(displaySteelReviewValue('system_order', '厚度', undefined)).toBe('');
  expect(displaySteelReviewValue('system_order', '厚度', '15mm')).toBe('15mm');
  expect(displaySteelReviewValue('system_order', '厚度', '15-20')).toBe('15-20');
});
