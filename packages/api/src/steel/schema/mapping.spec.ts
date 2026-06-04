import { buildSourceSchemaMappingPromptContext, resolveSourceSchemaMapping } from './mapping';

describe('Steel source schema mapping', () => {
  it('resolves reviewed reference headers to backend canonical keys', () => {
    expect(
      resolveSourceSchemaMapping({
        sourceFile: 'docs/reference/產品價格.xlsx',
        sourceLabel: '型號',
      }),
    ).toMatchObject({
      canonicalKey: 'erp_item_code',
      target: 'steel.price_items.erp_item_code',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '產品價格.xlsx',
        sourceLabel: '售價A',
      }),
    ).toMatchObject({
      canonicalKey: 'unit_price_by_tier.A',
      target: 'steel.price_items.unit_price',
      customerTierCode: 'A',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '產品價格.xlsx',
        sourceLabel: '單位重',
      }),
    ).toMatchObject({
      canonicalKey: 'product_price_unit_weight',
      target: 'steel.price_items.product_price_unit_weight',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '系統訂單.xlsx',
        sourceLabel: '公式編號',
      }),
    ).toMatchObject({
      canonicalKey: 'formula_code',
      target: 'steel.order_items.metadata.formula_code',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '公式編號.xlsx',
        sourceLabel: '公式計算式',
      }),
    ).toMatchObject({
      canonicalKey: 'formula_expression',
      target: 'steel.formula_versions.formula_body.expression',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '切工價錢.xlsx',
        sourceLabel: 'A/C/F',
      }),
    ).toMatchObject({
      canonicalKey: 'cutting_unit_price_by_tier.A_C_F',
      target: 'steel.cutting_prices.unit_price',
    });
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '客戶資料.xlsx',
        sourceLabel: '等級',
      }),
    ).toMatchObject({
      canonicalKey: 'customer_tier_code',
      target: 'steel.customer_tiers.code',
    });
  });

  it('does not resolve unknown labels or labels from the wrong source file', () => {
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '產品價格.xlsx',
        sourceLabel: '不存在欄位',
      }),
    ).toBeUndefined();
    expect(
      resolveSourceSchemaMapping({
        sourceFile: '客戶資料.xlsx',
        sourceLabel: '售價A',
      }),
    ).toBeUndefined();
  });

  it('builds compact prompt context scoped by source files and target usage', () => {
    const context = buildSourceSchemaMappingPromptContext({
      sourceFiles: ['產品價格.xlsx', '公式編號.xlsx'],
      allowedFor: 'price_lookup',
    });

    expect(context).toContain(
      '產品價格.xlsx: 售價A -> unit_price_by_tier.A (steel.price_items.unit_price)',
    );
    expect(context).toContain(
      '產品價格.xlsx: 單位重 -> product_price_unit_weight (steel.price_items.product_price_unit_weight)',
    );
    expect(context).toContain(
      '公式編號.xlsx: 公式編號 -> formula_code (steel.formula_versions.code)',
    );
    expect(context).not.toContain('客戶資料.xlsx');
    expect(context).not.toContain('不存在欄位');
  });
});
