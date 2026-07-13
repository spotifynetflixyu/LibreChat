import { applyCategoryStage, buildPriceCategoryReference, resolvePriceCategory } from './stage';

import type { SteelProductListRow } from './stage';

const row = (values: Partial<SteelProductListRow>): SteelProductListRow => ({
  erp_item_code: 'ERP-1',
  product_name: '百葉窗用銅鏍絲',
  category: '其他',
  unit: '只',
  ...values,
});

describe('Steel category stage', () => {
  it('builds a normalized-name reference and merges same-category duplicates', () => {
    const reference = buildPriceCategoryReference([
      row({ erp_item_code: 'A', product_name: 'ST＊方管', category: '方管' }),
      row({ erp_item_code: 'B', product_name: ' ST*方管 ', category: '方管' }),
      row({ erp_item_code: 'EMPTY', product_name: '', category: '其他' }),
    ]);

    expect(reference.byProductName.size).toBe(1);
    expect(resolvePriceCategory('ST×方管', reference)).toEqual({
      status: 'resolved',
      category: '方管',
      source: 'reference',
    });
  });

  it('rejects normalized duplicate names assigned to different categories', () => {
    expect(() =>
      buildPriceCategoryReference([
        row({ erp_item_code: 'A', product_name: '同名', category: '其他' }),
        row({ erp_item_code: 'B', product_name: '同名', category: '五金/配件' }),
      ]),
    ).toThrow('conflicting categories');
  });

  it('does not silently classify blank or unknown names as 其他', () => {
    expect(resolvePriceCategory('', buildPriceCategoryReference([]))).toEqual({
      status: 'unknown',
      reason: 'blank_product_name',
    });
    expect(resolvePriceCategory('全新未知商品', buildPriceCategoryReference([]))).toEqual({
      status: 'unknown',
      reason: 'no_matching_rule',
    });
  });

  it('changes only category, preserves order, and rejects duplicate ERP codes', () => {
    const reference = buildPriceCategoryReference([
      row({ product_name: '百葉窗用銅鏍絲', category: '五金/配件' }),
    ]);
    const source = [row({}), row({ erp_item_code: 'EMPTY', product_name: '', category: '其他' })];
    const result = applyCategoryStage(source, reference);

    expect(result.rows).toEqual([
      row({ category: '五金/配件' }),
      row({ erp_item_code: 'EMPTY', product_name: '', category: '其他' }),
    ]);
    expect(result.summary).toMatchObject({
      rowCount: 2,
      changedCategoryCount: 1,
      resolvedByReference: 1,
      preservedPlaceholderCount: 1,
      unknownCount: 0,
      readyForNormalization: true,
    });
    expect(() => applyCategoryStage([source[0], source[0]], reference)).toThrow(
      'duplicate erp_item_code',
    );
  });
});
