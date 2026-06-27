import { buildSteelPriceImportRows } from './import';

describe('Steel price v3 import normalization', () => {
  it('normalizes category, material, thickness, and all A/B/C/F prices into one row', () => {
    const rows = buildSteelPriceImportRows([
      {
        workbookName: '產品價格_20_切工／切割.xlsm',
        worksheetRowNumber: 2,
        row: {
          類別: '其他加工',
          材質: '不適用',
          厚度: '2',
          單位: '式',
          價格狀態: '有售價',
          '停用/缺貨註記': '否',
          原始列號: '8',
          型號: 'CUT001',
          品名規格: '切工測試',
          欄C: '75*45',
          欄D: '',
          售價A: '10',
          售價B: '20',
          售價C: '30',
          售價F: '40',
          比率A: '1',
          比率B: '2',
          比率C: '3',
          比率F: '4',
          單位重: '5',
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      priceKind: 'cutting',
      sourceDataset: 'product_price_v3',
      erpItemCode: 'CUT001',
      productName: '切工測試',
      category: '加工',
      material: '無',
      sourceCategoryLabel: '其他加工',
      sourceMaterialLabel: '不適用',
      sourceThickness: '2.0',
      sourceSpec: '75x45',
      unit: '式',
      unitPriceA: 10,
      unitPriceB: 20,
      unitPriceC: 30,
      unitPriceF: 40,
      productPriceUnitWeight: 5,
      active: true,
      valueState: 'confirmed',
      reviewState: 'reviewed',
    });
    expect(rows[0]).not.toHaveProperty('ratioA');
    expect(rows[0]).not.toHaveProperty('ratioB');
    expect(rows[0]).not.toHaveProperty('ratioC');
    expect(rows[0]).not.toHaveProperty('ratioF');
  });

  it('maps requested material cleanup values and stores no-price rows as unknown null prices', () => {
    const rows = buildSteelPriceImportRows([
      {
        workbookName: '產品價格_03_鐵板／鋼板.xlsm',
        worksheetRowNumber: 4,
        row: {
          類別: '鐵板/鋼板',
          材質: 'No1 白鐵3t以上含',
          厚度: '3',
          單位: 'Kg',
          價格狀態: '無售價/0價',
          '停用/缺貨註記': '是',
          原始列號: '11',
          型號: 'STNO1',
          品名規格: 'STNO1 3.0*4*8',
          欄C: '',
          欄D: '',
          售價A: '0',
          售價B: '0',
          售價C: '0',
          售價F: '0',
          比率A: '0',
          比率B: '0',
          比率C: '0',
          比率F: '0',
          單位重: '0',
        },
      },
      {
        workbookName: '產品價格_22_非鋼材／其他材料.xlsm',
        worksheetRowNumber: 5,
        row: {
          類別: '非鋼材/其他材料',
          材質: 'PC',
          厚度: '無',
          單位: 'piece',
          價格狀態: '有售價',
          '停用/缺貨註記': '否',
          原始列號: '12',
          型號: 'PC001',
          品名規格: 'PC 板',
          欄C: '',
          欄D: '',
          售價A: '100',
          售價B: '110',
          售價C: '120',
          售價F: '130',
          比率A: '',
          比率B: '',
          比率C: '',
          比率F: '',
          單位重: '',
        },
      },
    ]);

    expect(rows[0]).toMatchObject({
      material: 'No1 白鐵',
      sourceThickness: '3.0',
      unit: 'kg',
      unitPriceA: null,
      unitPriceB: null,
      unitPriceC: null,
      unitPriceF: null,
      productPriceUnitWeight: null,
      active: false,
      valueState: 'unknown',
      reviewState: 'needs_review',
    });
    expect(rows[1]).toMatchObject({
      material: '塑膠',
      unitPriceA: 100,
      unitPriceB: 110,
      unitPriceC: 120,
      unitPriceF: 130,
    });
  });

  it('imports corrected laser-cut shape plate rows as plate products', () => {
    const rows = buildSteelPriceImportRows([
      {
        workbookName: '產品價格_分類檔案_v3/產品價格_03_鐵板／鋼板.xlsm',
        worksheetRowNumber: 442,
        row: {
          類別: '切工/切割',
          材質: 'BA 白鐵亮面',
          厚度: '1.0',
          單位: '刀',
          價格狀態: '有售價',
          '停用/缺貨註記': '否',
          原始列號: '442',
          型號: 'B4NA900010',
          品名規格: '1.0BA 雷切割型',
          欄C: '',
          欄D: '',
          售價A: '100',
          售價B: '110',
          售價C: '120',
          售價F: '130',
          比率A: '1',
          比率B: '1.1',
          比率C: '1.2',
          比率F: '1.3',
          單位重: '',
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      priceKind: 'product',
      erpItemCode: 'B4NA900010',
      productName: '1.0BA 雷切割型',
      category: '鐵板/鋼板',
      sourceCategoryLabel: '鐵板/鋼板',
      material: 'BA 白鐵亮面',
      sourceThickness: '1.0',
      unit: '刀',
      unitPriceA: 100,
      unitPriceB: 110,
      unitPriceC: 120,
      unitPriceF: 130,
    });
    expect(rows[0].metadata).not.toHaveProperty('categoryCorrection');
  });

  it('imports cutting subcategory and spec fields from the updated cutting workbook', () => {
    const rows = buildSteelPriceImportRows([
      {
        workbookName: '產品價格_分類檔案_v3/產品價格_20_切工／切割.xlsm',
        worksheetRowNumber: 2,
        row: {
          類別: '切工/切割',
          次類別: 'H型鋼',
          規格: '200*100',
          單位: '刀',
          價格狀態: '有售價',
          '停用/缺貨註記': '否',
          原始列號: '900002',
          型號: '',
          品名規格: 'H型鋼 200*100 切工',
          欄C: '',
          欄D: '',
          售價A: '120',
          售價B: '125',
          售價C: '120',
          售價F: '120',
          比率A: '120',
          比率B: '125',
          比率C: '120',
          比率F: '120',
          單位重: '0',
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      priceKind: 'cutting',
      erpItemCode: null,
      productName: 'H型鋼 200*100 切工',
      category: '切工/切割',
      subcategory: 'H型鋼',
      sourceCategoryLabel: '切工/切割',
      sourceSubcategoryLabel: 'H型鋼',
      sourceSpec: '200x100',
      unit: '刀',
      unitPriceA: 120,
      unitPriceB: 125,
      unitPriceC: 120,
      unitPriceF: 120,
      productPriceUnitWeight: null,
    });
    expect(rows[0]?.specKey).toContain('H型鋼200x100切工');
  });
});
