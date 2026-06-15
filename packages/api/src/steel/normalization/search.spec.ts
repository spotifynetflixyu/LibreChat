import { generateSteelPriceSearchTerms } from './search';

describe('generateSteelPriceSearchTerms', () => {
  it('keeps AI-proposed product-name/spec text and ERP code prefix candidates', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: 'C75*3630mm*76隻',
      candidates: [
        {
          queryId: 'raw-user-text',
          label: 'C75*3630mm*76隻',
          productNames: ['C75*3630mm*76隻'],
          confidence: 'low',
          reason: 'raw user text should not be used directly',
        },
        {
          queryId: 'galvanized-c-type',
          label: '錏輕型鋼 75*2.3',
          productNames: ['錏輕型鋼', '75*2.3'],
          erpItemCodes: ['CCG'],
          confidence: 'high',
          reason: 'C 型鋼 defaults to 錏輕型鋼 and price rows carry spec in product_name',
        },
      ],
      structuredFilters: {
        categories: ['c_type'],
        sizeAMm: 75,
        thicknessMm: 2.3,
      },
    });

    expect(result).toMatchObject({
      originalText: 'C75*3630mm*76隻',
      rawTextSearchAllowed: false,
      structuredFilters: {
        categories: ['c_type'],
        sizeAMm: 75,
        thicknessMm: 2.3,
      },
      candidateQueries: [
        {
          queryId: 'galvanized-c-type',
          productNames: ['錏輕型鋼', '75*2.3'],
          erpItemCodes: ['CCG'],
          confidence: 'high',
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
            productNames: ['亞L30x30'],
            confidence: 'low',
            reason: 'raw user text only',
          },
        ],
      }),
    ).toThrow('Provide at least one derived price search candidate');
  });

  it('derives OT laser-cut plate product-name candidates from PL oral specs', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: 'PL6*80',
      candidates: [
        {
          queryId: 'raw-pl-plate',
          label: 'PL6*80',
          productNames: ['PL6*80'],
          confidence: 'low',
          reason: 'raw PL oral plate text needs reviewed product-price name expansion',
        },
      ],
    });

    expect(result.candidateQueries).toEqual([
      expect.objectContaining({
        queryId: 'raw-pl-plate:ot-laser',
        productNames: ['6.0m/mOT板雷射切割', 'OT板雷射切割', '黑鐵板 雷射切割'],
        confidence: 'high',
      }),
    ]);
    expect(JSON.stringify(result.candidateQueries)).not.toContain('四方切');
  });

  it('caps candidate queries without rewriting product-name spec fragments', () => {
    const result = generateSteelPriceSearchTerms({
      originalText: '3*3鍍鋅方管',
      maxQueries: 2,
      candidates: [
        {
          queryId: 'galvanized-square-pipe',
          productNames: ['錏方管', '75*2.0'],
          erpItemCodes: ['GDH'],
          confidence: 'high',
          reason: '3*3 maps to 75mm square tube candidates',
        },
        {
          queryId: 'square-pipe',
          productNames: ['方管', '75x75'],
          confidence: 'medium',
          reason: 'broader square tube fallback',
        },
        {
          queryId: 'inch-square-pipe',
          productNames: ['3寸', '方管'],
          confidence: 'low',
          reason: 'inch wording fallback',
        },
      ],
    });

    expect(result.candidateQueries).toEqual([
      expect.objectContaining({
        queryId: 'galvanized-square-pipe',
        productNames: ['錏方管', '75*2.0'],
        erpItemCodes: ['GDH'],
      }),
      expect.objectContaining({
        queryId: 'square-pipe',
        productNames: ['方管', '75x75'],
      }),
    ]);
  });
});
