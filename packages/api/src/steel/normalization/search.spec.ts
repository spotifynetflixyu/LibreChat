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

  it('prefers normalized compact specKey fragments over malformed specKeyContains', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: 'C型鋼 100x50x20 2.3t 一支多少',
      candidates: [
        {
          queryId: 'c-type-100x23',
          productName: '錏輕型鋼',
          specKey: '100x2.3',
          specKeyContains: '100 2.3',
          confidence: 'high',
          reason: 'AI derived the compact C 型鋼 price key but formatted contains badly',
        },
      ],
    });

    expect(result.candidateQueries[0]).toMatchObject({
      queryId: 'c-type-100x23',
      productName: '錏輕型鋼',
      specKeyContains: '100x2.3',
    });
    expect(result.candidateQueries[0]).not.toHaveProperty('specKey');
  });

  it('normalizes H-beam slash thickness fragments to price-table spec key fragments', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: 'H型鋼 100x50x5/7x6M 一支多少',
      candidates: [
        {
          queryId: 'h-beam-100-50-5-7-6m',
          productName: 'H型鋼',
          specKey: '100x50x5/7 6M',
          specKeyContains: '100x50x5/7',
          confidence: 'high',
          reason: 'AI derived H 型鋼 section and length from oral text',
        },
      ],
    });

    expect(result.candidateQueries[0]).toMatchObject({
      queryId: 'h-beam-100-50-5-7-6m',
      productName: 'H型鋼',
      specKeyContains: '100x50x5_7',
    });
    expect(result.candidateQueries[0]).not.toHaveProperty('specKey');
  });

  it('prefers structured specKey over malformed whitespace-separated specKeyContains', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: '錏成型角鐵30*2.5*6M，第1級價格',
      candidates: [
        {
          queryId: 'angle-30-25-6m',
          productName: '錏成型角鐵',
          specKey: '30x2.5x6M',
          specKeyContains: '30 2.5 6M',
          confidence: 'high',
          reason: 'AI provided a structured specKey and a malformed contains fragment',
        },
      ],
    });

    expect(result.candidateQueries[0]).toMatchObject({
      queryId: 'angle-30-25-6m',
      productName: '錏成型角鐵',
      specKeyContains: '30x2.5x6m',
    });
    expect(result.candidateQueries[0]).not.toHaveProperty('specKey');
  });
});
