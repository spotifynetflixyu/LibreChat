import { parseSteelSourceRefs, serializeSteelSourceRefsForInsert } from './types';

describe('Steel repository source refs', () => {
  it('accepts canonical source refs and preserves optional trace fields', () => {
    const refs = parseSteelSourceRefs([
      {
        channel: 'admin_erp_xlsx',
        factType: 'product_price',
        sourceFile: 'docs/reference/產品價格.xlsx',
        sourceVersionId: 'source-version-1',
        locator: 'sheet=Sheet1;row=6',
        confidence: 'high',
        extractedLabel: '售價A',
        canonicalKey: 'unit_price',
      },
    ]);

    expect(refs).toEqual([
      {
        channel: 'admin_erp_xlsx',
        factType: 'product_price',
        sourceFile: 'docs/reference/產品價格.xlsx',
        sourceVersionId: 'source-version-1',
        locator: 'sheet=Sheet1;row=6',
        confidence: 'high',
        extractedLabel: '售價A',
        canonicalKey: 'unit_price',
      },
    ]);
  });

  it('rejects source refs without required provenance fields before writes', () => {
    expect(() =>
      serializeSteelSourceRefsForInsert([
        {
          channel: 'admin_erp_xlsx',
          locator: 'sheet=Sheet1;row=6',
        },
      ]),
    ).toThrow('Steel source ref requires factType');
  });

  it('rejects non-array source refs', () => {
    expect(() => parseSteelSourceRefs({ channel: 'manual' })).toThrow(
      'Steel source_refs must be an array',
    );
  });
});
