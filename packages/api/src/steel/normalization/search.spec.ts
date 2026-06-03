import { generateSteelPriceSearchTerms } from './search';

describe('generateSteelPriceSearchTerms', () => {
  it('turns AI-proposed material/spec candidates into bounded price-table queries', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: '亞L30x30',
      candidates: [
        {
          queryId: 'raw-user-text',
          label: '亞L30x30',
          productName: '亞L30x30',
          confidence: 'low',
          reason: 'raw user text should not be used directly',
        },
        {
          queryId: 'formed-angle-ya',
          label: '錏成型角鐵 30x30',
          productName: '錏成型角鐵',
          specKeyContains: '30x30',
          confidence: 'medium',
          reason: 'AI interpreted L30x30 as equal-angle steel and 亞 as possible 錏',
        },
        {
          queryId: 'galvanized-angle',
          label: '鍍鋅角鐵 30x30',
          productName: '鍍鋅角鐵',
          specKeyContains: '30x30',
          confidence: 'low',
          reason: '錏 may point to galvanized surface-treatment wording',
        },
        {
          queryId: 'angle-only',
          label: '角鐵 30x30',
          productName: '角鐵',
          specKeyContains: '30x30',
          confidence: 'medium',
          reason: 'L30x30 is a common equal-angle notation',
        },
      ],
      structuredFilters: {
        categories: ['angle'],
        surfaces: ['錏', '鍍鋅'],
        sizeAMm: 30,
        sizeBMm: 30,
      },
    });

    expect(result).toMatchObject({
      originalText: '亞L30x30',
      rawTextSearchAllowed: false,
      structuredFilters: {
        categories: ['angle'],
        surfaces: ['錏', '鍍鋅'],
        sizeAMm: 30,
        sizeBMm: 30,
      },
      candidateQueries: [
        {
          queryId: 'formed-angle-ya',
          productName: '錏成型角鐵',
          specKeyContains: '30x30',
          confidence: 'medium',
        },
        {
          queryId: 'galvanized-angle',
          productName: '鍍鋅角鐵',
          specKeyContains: '30x30',
          confidence: 'low',
        },
        {
          queryId: 'angle-only',
          productName: '角鐵',
          specKeyContains: '30x30',
          confidence: 'medium',
        },
      ],
      rejectedQueries: [
        {
          queryId: 'raw-user-text',
          reason: 'raw_user_text_is_not_a_reviewed_candidate',
        },
      ],
    });
  });

  it('rejects raw-only search terms before table lookup', () => {
    expect(() =>
      generateSteelPriceSearchTerms({
        originalText: '亞L30x30',
        candidates: [
          {
            queryId: 'raw-user-text',
            label: '亞L30x30',
            productName: '亞L30x30',
            confidence: 'low',
            reason: 'raw user text only',
          },
        ],
      }),
    ).toThrow('Provide at least one derived price search candidate');
  });

  it('downgrades size-only specKey candidates to partial spec lookup', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: '亞L30x30 一支多少',
      candidates: [
        {
          queryId: 'formed-angle-ya',
          label: '錏角鐵 30x30',
          productName: '錏角鐵',
          specKey: '30x30',
          specKeyContains: '30x30',
          confidence: 'high',
          reason: 'AI interpreted L30x30 as angle steel 30x30',
        },
      ],
    });

    expect(result.candidateQueries[0]).toMatchObject({
      queryId: 'formed-angle-ya',
      productName: '錏角鐵',
      specKeyContains: '30x30',
    });
    expect(result.candidateQueries[0]).not.toHaveProperty('specKey');
  });
});
