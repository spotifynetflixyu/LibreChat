import path from 'path';

import { buildSteelReferenceImportPlan } from './reference';

const referenceDir = path.resolve(__dirname, '../../../../..', 'docs/reference');

describe('Steel reference data importer', () => {
  it('classifies workbook-only references away from DB fact imports', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });

    expect(plan.factSources).toEqual(
      expect.arrayContaining([
        '客戶資料.xlsx',
        '產品價格.xlsx',
        '切工價錢.xlsx',
        '公式編號.xlsx',
        'H型鋼.txt',
      ]),
    );
    expect(plan.workbookOnlySources).toEqual(
      expect.arrayContaining(['訂單參考.xlsm', '系統訂單.xlsx']),
    );
    expect(plan.factSources).not.toContain('訂單參考.xlsm');
    expect(plan.factSources).not.toContain('系統訂單.xlsx');
  });

  it('extracts customers, tiered prices, cutting prices, formulas, and defaults', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });

    expect(plan.catalogFamilies.map((family) => family.key)).toEqual(
      expect.arrayContaining(['h_beam', 'c_type', 'angle']),
    );
    expect(plan.customerTiers.map((tier) => tier.code)).toEqual(
      expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F']),
    );
    expect(plan.customers).toHaveLength(2256);
    expect(plan.priceItems.length).toBeGreaterThan(20000);
    expect(plan.cuttingPrices.length).toBeGreaterThan(100);
    expect(plan.formulaVersions.map((formula) => formula.code)).toEqual(
      expect.arrayContaining(['C', 'H', 'BH']),
    );
    expect(plan.quoteDefaults.length).toBeGreaterThan(5);
  });

  it('normalizes source product names to fixed catalog-family keys', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });
    const hBeamItem = plan.priceItems.find((item) => item.productName.includes('H型鋼'));
    const cTypeItem = plan.priceItems.find((item) => item.erpItemCode === 'CCG10023');
    const cTypeFamily = plan.catalogFamilies.find((family) => family.key === 'c_type');
    const angleItem = plan.priceItems.find((item) => item.erpItemCode === 'ELD12025');
    const fixedLengthAngleItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'ELB0100750709' && item.customerTierCode === 'A',
    );
    const stainlessFlatBarFromParentheses = plan.priceItems.find(
      (item) => item.erpItemCode === 'EIS20080' && item.customerTierCode === 'A',
    );
    const stainlessFlatBarFromColumn = plan.priceItems.find(
      (item) => item.erpItemCode === 'EIS10050' && item.customerTierCode === 'A',
    );
    const lightHBeamItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'EHC150706' && item.customerTierCode === 'A',
    );
    const railItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'ERB06060' && item.customerTierCode === 'A',
    );
    const proportionalRailItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'ERB09060' && item.customerTierCode === 'A',
    );
    const fallbackSpringItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'AVA0414' && item.customerTierCode === 'A',
    );
    const stainlessPlateItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'BNA0054019' && item.customerTierCode === 'A',
    );
    const hairlinePlateItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'BNH0054020' && item.customerTierCode === 'A',
    );
    const otPatternPlateItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'BXB030408' && item.customerTierCode === 'A',
    );
    const galvanizedPatternPlateItem = plan.priceItems.find(
      (item) => item.erpItemCode === 'BXH030408' && item.customerTierCode === 'A',
    );
    const hBeamDefault = plan.quoteDefaults.find(
      (defaultRow) => defaultRow.originId === 'h-type-non-standard-length-surcharge-v1',
    );

    expect(hBeamItem?.catalogFamily).toBe('h_beam');
    expect(cTypeItem?.catalogFamily).toBe('c_type');
    expect(cTypeItem).toMatchObject({
      unit: 'kg',
      productPriceUnitWeight: 4,
      productPriceUnitWeightUnit: 'kg_per_m',
    });
    expect(cTypeFamily?.metadata).toEqual(
      expect.objectContaining({
        searchHints: expect.arrayContaining(['白鐵輕型鋼', '錏輕型鋼', '黑鐵輕型鋼', '100x2.3']),
      }),
    );
    expect(angleItem?.catalogFamily).toBe('angle');
    expect(fixedLengthAngleItem).toMatchObject({
      productName: '不等邊黑角鐵100*75*7.0*9M(84)',
      unit: 'kg',
      productPriceUnitWeight: 84,
      productPriceUnitWeightUnit: 'kg_per_piece',
    });
    expect(stainlessFlatBarFromParentheses).toMatchObject({
      productName: '白鐵平鐵 50 *8.0( 19.7)',
      unit: 'piece',
      unitPrice: 2107.9,
      productPriceUnitWeight: 19.7,
      productPriceUnitWeightUnit: 'kg_per_piece',
      metadata: expect.objectContaining({
        sourceRatio: 107,
        sourcePriceUnitBasis: 'per_piece_total',
        sourceUnitWeightColumn: 0,
        sourceUnitWeightOrigin: 'product_name_parentheses',
        sourceParentheticalUnitWeight: 19.7,
      }),
    });
    expect(stainlessFlatBarFromParentheses?.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factType: 'product_price_unit_weight',
          extractedLabel: '品名括號單位重',
          canonicalKey: 'product_price_unit_weight',
        }),
      ]),
    );
    expect(stainlessFlatBarFromColumn).toMatchObject({
      productName: '白鐵平鐵 25 *5.0 (5.95)',
      unit: 'piece',
      unitPrice: 624.75,
      productPriceUnitWeight: 5.95,
      productPriceUnitWeightUnit: 'kg_per_piece',
      metadata: expect.objectContaining({
        sourceRatio: 105,
        sourcePriceUnitBasis: 'per_piece_total',
        sourceUnitWeightOrigin: 'unit_weight_column',
        sourceParentheticalUnitWeight: 5.95,
      }),
    });
    expect(lightHBeamItem).toMatchObject({
      catalogFamily: 'h_beam',
      productName: '輕量H150*75*3.2/4.5*6M(53)',
      productPriceUnitWeight: 53,
      productPriceUnitWeightUnit: 'kg_per_piece',
    });
    expect(railItem).toMatchObject({
      catalogFamily: 'rail',
      productName: '6K鐵軌 6M(38)(件55支)凸面22.0非25.4',
      unit: 'piece',
      unitPrice: 2090,
      productPriceUnitWeight: 36,
      productPriceUnitWeightUnit: 'kg_per_piece',
      metadata: expect.objectContaining({
        sourcePriceUnitBasis: 'per_piece_total',
        sourceUnitWeightOrigin: 'unit_weight_column',
        sourceParentheticalUnitWeight: 38,
      }),
    });
    expect(proportionalRailItem).toMatchObject({
      catalogFamily: 'rail',
      productName: '9K鐵軌 6M(54)',
      productPriceUnitWeight: 54,
      productPriceUnitWeightUnit: 'kg_per_piece',
      metadata: expect.objectContaining({
        sourceUnitWeightOrigin: 'unit_weight_column',
      }),
    });
    expect(stainlessPlateItem).toMatchObject({
      catalogFamily: 'plate',
      productName: "STBA 0.5*4'*1M9(9.3)",
      unit: 'piece',
      productPriceUnitWeight: 9.3,
      productPriceUnitWeightUnit: 'kg_per_piece',
    });
    expect(hairlinePlateItem).toMatchObject({
      catalogFamily: 'plate',
      productName: "STHL 0.5*4'*2M(9.79)",
      productPriceUnitWeight: 9.79,
      productPriceUnitWeightUnit: 'kg_per_piece',
    });
    expect(otPatternPlateItem?.catalogFamily).toBe('ot_plate');
    expect(galvanizedPatternPlateItem?.catalogFamily).toBe('galvanized_plate');
    expect(fallbackSpringItem).toMatchObject({
      catalogFamily: 'erp_ava',
      productName: '彈簧4#14 (4.18)',
      unit: 'piece',
      productPriceUnitWeight: null,
      productPriceUnitWeightUnit: null,
      metadata: expect.objectContaining({
        sourcePriceUnitBasis: 'per_piece_or_unit',
        sourceUnitWeightOrigin: null,
        sourceParentheticalUnitWeight: null,
      }),
    });
    expect(hBeamDefault?.catalogFamily).toBe('h_beam');
  });

  it('maps product-price mesh, floor deck, rectangular pipe, and panel rows to reviewed keys', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });
    const getPriceItem = (erpItemCode: string) =>
      plan.priceItems.find(
        (item) => item.erpItemCode === erpItemCode && item.customerTierCode === 'A',
      );

    expect(plan.catalogFamilies.map((family) => family.key)).toEqual(
      expect.arrayContaining([
        'wire_mesh',
        'expanded_metal',
        'floor_deck',
        'rectangular_pipe',
        'corrugated_panel',
      ]),
    );
    expect(getPriceItem('IGB')?.catalogFamily).toBe('wire_mesh');
    expect(getPriceItem('CNE2030')?.catalogFamily).toBe('wire_mesh');
    expect(getPriceItem('BWB030408')?.catalogFamily).toBe('expanded_metal');
    expect(getPriceItem('CNG5012')?.catalogFamily).toBe('floor_deck');
    expect(getPriceItem('GEB204015')?.catalogFamily).toBe('rectangular_pipe');
    expect(getPriceItem('HMG030')?.catalogFamily).toBe('corrugated_panel');
    expect(getPriceItem('HNG03')?.catalogFamily).toBe('corrugated_panel');
    expect(getPriceItem('HSE2929')?.catalogFamily).toBe('aluminum_window');
    expect(getPriceItem('FTB0311')?.catalogFamily).toBe('screw');
  });

  it('imports generic catalog families and categories for every product-price row', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });
    const planWithCatalog = plan as unknown as {
      catalogFamilies?: Array<{ key: string; displayNameZh: string }>;
      priceCategories?: Array<{ code: string; name: string; catalogFamily: string }>;
      priceItems: Array<{
        erpItemCode: string;
        customerTierCode: string;
        categoryCode?: string;
        catalogFamily?: string;
      }>;
    };
    const catalogKeys = planWithCatalog.catalogFamilies?.map((family) => family.key) ?? [];
    const categoryCodes = new Set(
      planWithCatalog.priceCategories?.map((category) => category.code),
    );
    const getPriceItem = (erpItemCode: string) =>
      planWithCatalog.priceItems.find(
        (item) => item.erpItemCode === erpItemCode && item.customerTierCode === 'A',
      );

    expect(catalogKeys).toEqual(
      expect.arrayContaining([
        'steel_pipe',
        'piping',
        'wall_panel',
        'resin_panel',
        'aluminum_window',
        'water_stop_plate',
        'iron_door',
        'canopy_frame',
        'square_pipe_connector',
        'telescopic_gate',
        'b_pipe',
        'a_pipe',
        'measuring_tool',
        'screen_mesh',
        'door_decoration',
        'p_pipe',
        'screw',
        'corner_wheel',
        'door_lock',
        'i_beam',
        'round_bar',
        'square_bar',
        'galvanized_plate',
        'ot_plate',
        'black_plate',
        'grating',
      ]),
    );
    expect(planWithCatalog.priceCategories?.length).toBeGreaterThan(200);
    expect(planWithCatalog.priceItems.every((item) => item.categoryCode)).toBe(true);
    expect(planWithCatalog.priceItems.every((item) => item.catalogFamily)).toBe(true);
    expect(
      planWithCatalog.priceItems.every((item) => categoryCodes.has(item.categoryCode ?? '')),
    ).toBe(true);
    expect(getPriceItem('GOB0004')?.catalogFamily).toBe('a_pipe');
    expect(getPriceItem('GOS0215')?.catalogFamily).toBe('piping');
    expect(getPriceItem('HSA12215')?.catalogFamily).toBe('aluminum_window');
    expect(getPriceItem('HSS0001')?.catalogFamily).toBe('iron_door');
    expect(getPriceItem('FTB0311')?.catalogFamily).toBe('screw');
    expect(getPriceItem('FFP00020')?.catalogFamily).toBe('corner_wheel');
    expect(getPriceItem('FFL0001')?.catalogFamily).toBe('door_lock');
    expect(getPriceItem('EZB070709')?.catalogFamily).toBe('i_beam');
    expect(getPriceItem('EQA0030')?.catalogFamily).toBe('round_bar');
    expect(getPriceItem('EDA0063')?.catalogFamily).toBe('square_bar');
    expect(getPriceItem('BNG008408')?.catalogFamily).toBe('galvanized_plate');
    expect(getPriceItem('BNB012408')?.catalogFamily).toBe('ot_plate');
    expect(getPriceItem('DNB160408')?.catalogFamily).toBe('black_plate');
    expect(getPriceItem('ANB3410')?.catalogFamily).toBe('grating');
  });

  it('treats blank or zero source prices as unknown rather than true zero', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });
    const zeroPriceItem = plan.priceItems.find(
      (item) => item.erpItemCode === '0000' && item.customerTierCode === 'A',
    );

    expect(zeroPriceItem).toMatchObject({
      unitPrice: null,
      valueState: 'unknown',
      reviewState: 'needs_review',
    });
  });

  it('creates source refs for imported facts and puts fuzzy notes into defaults', () => {
    const plan = buildSteelReferenceImportPlan({ referenceDir });
    const cuttingDefault = plan.quoteDefaults.find((defaultRow) =>
      JSON.stringify(defaultRow.defaultParameters).includes('另計'),
    );

    expect(plan.priceItems[0]?.sourceRefs[0]).toMatchObject({
      sourceFile: 'docs/reference/產品價格.xlsx',
      locator: expect.stringContaining('sheet=Sheet1;row='),
    });
    expect(cuttingDefault).toBeDefined();
    expect(cuttingDefault?.effect).toBe('preference_rule');
    expect(cuttingDefault?.sourceRefs[0]?.sourceFile).toEqual(
      expect.stringContaining('docs/reference/'),
    );
  });
});
