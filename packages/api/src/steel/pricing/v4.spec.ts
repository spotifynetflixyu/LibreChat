import { buildSteelPriceV4Rows } from './v4';

import type { SteelPriceV4Cell, SteelPriceV4WorkbookRow } from './v4';

type LegacyTestWorkbookRow = SteelPriceV4WorkbookRow & {
  normalized_spec_text: SteelPriceV4Cell;
  dimension_signature: SteelPriceV4Cell;
  source_thickness: SteelPriceV4Cell;
};

function makeWorkbookRow(overrides: Partial<LegacyTestWorkbookRow> = {}): LegacyTestWorkbookRow {
  const row: LegacyTestWorkbookRow = {
    formula_code: 'H200100',
    erp_item_code: '00123',
    product_name: 'H型鋼 200x100',
    spec_key: '',
    normalized_spec_text: 'H200x100x5.5x8',
    category: 'H型鋼',
    subcategory: '',
    processing_method: '',
    processing_shape: '',
    material: 'OT 黑鐵',
    dimension_signature: '200x100x5.5x8',
    unit: '支',
    value_state: 'confirmed',
    unit_price_base: '0',
    unit_price_a: '1,200',
    unit_price_b: '1100',
    unit_price_c: 1000,
    unit_price_d: '0',
    unit_price_e: '',
    unit_price_f: '900',
    price_ratio_a: '0',
    price_ratio_b: '1.2',
    price_ratio_c: 1.1,
    price_ratio_d: '0',
    price_ratio_e: '',
    price_ratio_f: null,
    unit_weight_value: '21.3',
    unit_weight_basis: 'M',
    density: '7.85',
    source_thickness: '5.5',
    thicknessMinMm: '',
    thicknessMaxMm: '',
    width_mm: '200',
    height_mm: '100',
    length_mm: '6000',
    outer_diameter_mm: '',
    nominal_inch: null,
    web_mm: '5.5',
    flange_mm: '8',
    lip_mm: '0',
    sheet_width_mm: '',
    sheet_length_mm: '',
    spec_sort_key: '0200|0100|0055|0080',
    cost_basis: '2.數量',
    ...overrides,
  };
  const legacySpecText = String(row.normalized_spec_text ?? '').trim();
  if (!String(row.spec_key ?? '').trim()) {
    row.spec_key = legacySpecText ? `${row.erp_item_code} ${legacySpecText}` : row.erp_item_code;
  }
  if (!String(row.thicknessMinMm ?? '').trim() && !String(row.thicknessMaxMm ?? '').trim()) {
    const sourceThickness = String(row.source_thickness ?? '').trim();
    const match = sourceThickness.match(
      /^([0-9]+(?:\.[0-9]+)?)\s*(?:[-~～至]\s*([0-9]+(?:\.[0-9]+)?))?/u,
    );
    const [parsedWithoutSourceThickness] = buildSteelPriceV4Rows([row]);
    const ignoredCategory = new Set([
      '圓管',
      '方管',
      '扁方管',
      '槽鐵',
      '角鐵',
      '網',
      '鋼筋',
      '鐵軌',
    ]).has(String(row.category));
    const min = match?.[1] ? Number(match[1]) : null;
    const productName = String(row.product_name ?? '')
      .normalize('NFKC')
      .toUpperCase();
    const surfaceCodeOnly =
      row.category === '鐵板' &&
      ((min === 2 && productName.includes('2B')) || (min === 1 && productName.includes('NO1')));
    if (
      match?.[1] &&
      min !== null &&
      min > 0 &&
      parsedWithoutSourceThickness?.thicknessMinMm === null &&
      !ignoredCategory &&
      !surfaceCodeOnly
    ) {
      row.thicknessMinMm = match[1];
      row.thicknessMaxMm = match[2] ?? match[1];
    }
  }
  return row;
}

describe('Steel price v4.4 parser', () => {
  it('preserves leading-zero ERP codes and returns only importable quote fields', () => {
    const [row] = buildSteelPriceV4Rows([makeWorkbookRow()]);

    expect(row).toEqual({
      formulaCode: 'H200100',
      erpItemCode: '00123',
      productName: 'H型鋼 200x100',
      category: 'H型鋼',
      subcategory: '',
      processingMethod: null,
      processingShape: null,
      material: 'OT 黑鐵',
      unit: '支',
      valueState: 'confirmed',
      unitPriceBase: null,
      unitPriceA: 1200,
      unitPriceB: 1100,
      unitPriceC: 1000,
      unitPriceD: null,
      unitPriceE: null,
      unitPriceF: 900,
      priceRatioA: null,
      priceRatioB: 1.2,
      priceRatioC: 1.1,
      priceRatioD: null,
      priceRatioE: null,
      priceRatioF: null,
      unitWeightValue: 21.3,
      unitWeightBasis: 'M',
      density: 7.85,
      thicknessMinMm: 5.5,
      thicknessMaxMm: 5.5,
      widthMm: 200,
      heightMm: 100,
      lengthMm: 6000,
      outerDiameterMm: null,
      nominalInch: null,
      webMm: 5.5,
      flangeMm: 8,
      lipMm: null,
      sheetWidthMm: null,
      sheetLengthMm: null,
      specSortKey: '0200|0100|0055|0080',
      costBasis: '2.數量',
      specKey: '00123 H200x100x5.5x8',
    });
    for (const retiredField of [
      'priceKind',
      'sourceDataset',
      'sourceRowKey',
      'normalizedSpecText',
      'dimensionSignature',
      'sourceThickness',
      'currency',
      'active',
      'sourceRefs',
      'importedAt',
      'createdAt',
      'updatedAt',
    ]) {
      expect(row).not.toHaveProperty(retiredField);
    }
  });

  it('keeps nullable product, normalized spec, and unit fields as null', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: '00000',
        product_name: '',
        normalized_spec_text: null,
        unit: undefined,
      }),
    ]);

    expect(row).toMatchObject({
      erpItemCode: '00000',
      productName: null,
      unit: null,
      specKey: '00000',
    });
  });

  it('does not infer galvanized material from a hot-dip usage description outside material categories', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'FCP1104',
        product_name: '合金底漆(白鐵熱浸鍍鋅用)-1加',
        normalized_spec_text: '合金底漆(白鐵熱浸鍍鋅用)-1加',
        category: '五金/配件',
        material: '',
      }),
    ]);

    expect(row?.material).toBeNull();
  });

  it('normalizes optional physical zero placeholders to null', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        unit_weight_value: '0',
        density: 0,
        source_thickness: '0.0',
        width_mm: '0',
        height_mm: 0,
        length_mm: '0.0',
        outer_diameter_mm: '0',
        web_mm: 0,
        flange_mm: '0.0',
        lip_mm: '0',
        sheet_width_mm: 0,
        sheet_length_mm: '0.0',
      }),
    ]);

    expect(row).toMatchObject({
      unitWeightValue: null,
      density: null,
      widthMm: null,
      heightMm: null,
      lengthMm: null,
      outerDiameterMm: null,
      webMm: null,
      flangeMm: null,
      lipMm: null,
      sheetWidthMm: null,
      sheetLengthMm: null,
    });
  });

  it.each([
    { unit_price_a: '-1' },
    { price_ratio_b: '-1' },
    { unit_weight_value: '-1' },
    { density: '-1' },
    { width_mm: '-1' },
  ])('rejects negative database-constrained numeric values', (overrides) => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow(overrides)])).toThrow();
  });

  it.each([
    ['ST2B', '2'],
    ['STNO1', '1'],
  ])('clears surface-code-only plate thickness from %s', (productName, source) => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: `PLATE-GENERIC-${source}`,
        category: '鐵板',
        product_name: productName,
        normalized_spec_text: productName,
        source_thickness: source,
      }),
    ]);

    expect(row).toMatchObject({ thicknessMinMm: null, thicknessMaxMm: null });
  });

  it.each(['', 'bogus'])('rejects unsupported cost basis %s', (costBasis) => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow({ cost_basis: costBasis })])).toThrow();
  });

  it('derives inclusive material-thickness bands without treating hole diameters as thickness', () => {
    const [range, exact, sourceRange, diameterRange] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'DZA0612',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '厚度6.0-12.0m/m鐵板鑽孔φ',
        normalized_spec_text: '厚度6.0-12.0mm鐵板鑽孔φ t6mm',
        source_thickness: '6',
      }),
      makeWorkbookRow({
        erp_item_code: 'HOLE03',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '厚度3.0m/m鐵板鑽孔φ',
        normalized_spec_text: '厚度3.0mm鐵板鑽孔φ',
        source_thickness: '3',
      }),
      makeWorkbookRow({
        erp_item_code: 'HOLE-RANGE',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '鐵板鑽孔φ',
        normalized_spec_text: '鐵板鑽孔φ',
        source_thickness: '20~25m/m',
      }),
      makeWorkbookRow({
        erp_item_code: 'BLZZE2',
        category: '加工/孔',
        subcategory: '鐵板',
        product_name: '沖孔φ(1.0~2.0)',
        normalized_spec_text: '沖孔φ(1.0~2.0)',
        source_thickness: '',
      }),
    ]);

    expect(range).toMatchObject({ thicknessMinMm: 6, thicknessMaxMm: 12 });
    expect(exact).toMatchObject({ thicknessMinMm: 3, thicknessMaxMm: 3 });
    expect(sourceRange).toMatchObject({ thicknessMinMm: 20, thicknessMaxMm: 25 });
    expect(diameterRange).toMatchObject({ thicknessMinMm: null, thicknessMaxMm: null });
  });

  it.each([
    ['ST2B 3.0 切', '2', 3],
    ['10.0m/mSTNO1切清', '1', 10],
    ['1.02B 雷切割型', '2', 1],
    ['3.0NO1 雷切割型', '1', 3],
    ["STBA 0.5x4'x1M8(8.81)", '0.5', 0.5],
    ["STHL 0.5x4'x1M8(8.81)", '0.5', 0.5],
  ])(
    'derives plate thickness from %s instead of surface-code digits',
    (productName, source, expected) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `PLATE-${expected}`,
          category: '鐵板',
          product_name: productName,
          normalized_spec_text: productName,
          source_thickness: source,
        }),
      ]);

      expect(row).toMatchObject({ thicknessMinMm: expected, thicknessMaxMm: expected });
    },
  );

  it.each([
    ['磨光方鐵 1/4" (3M)', 6.35, '1/4', 3000, null],
    ['磨光方鐵 5/8 (整支) 以過磅重計', 15.875, '5/8', null, null],
    ['磨光方鐵 25mm (整支) 以過磅重計', 25, null, null, null],
    ['黑鐵方鐵3/8" 以過磅重計', 9.525, '3/8', null, null],
    ['白鐵方鐵 6.0*6M(1.72)', 6, null, 6000, 1.72],
    ['白鐵方鐵 10.0(4.79)', 10, null, null, 4.79],
  ])(
    'normalizes square-bar dimensions, stock length, and weight from %s',
    (productName, sideMm, nominalInch, lengthMm, unitWeightValue) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `SQUARE-${productName}`,
          category: '方鐵',
          product_name: productName,
          normalized_spec_text: productName.replaceAll('*', 'x'),
          width_mm: '',
          height_mm: '',
          length_mm: '',
          nominal_inch: '',
          unit_weight_value: '',
          unit_weight_basis: '',
          source_thickness: '',
        }),
      ]);

      const unitWeightBasis =
        unitWeightValue !== null && lengthMm !== null ? 'kg_per_piece_or_stock_length' : null;

      expect(row).toMatchObject({
        widthMm: sideMm,
        heightMm: sideMm,
        nominalInch,
        lengthMm,
        unitWeightValue,
        unitWeightBasis,
      });
    },
  );

  it.each([
    '磨光方鐵 1/2-32mm切',
    '黑鐵方鐵 25mm-38mm切',
    '黑鐵方鐵 51mm-60m/m以內切',
    '黑鐵方鐵 60m/m以上切',
  ])('does not collapse square-bar cutting ranges into one material size for %s', (productName) => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: `SQUARE-RANGE-${productName}`,
        category: '方鐵',
        product_name: productName,
        normalized_spec_text: productName,
        width_mm: '60',
        height_mm: '60',
        source_thickness: '',
      }),
    ]);

    expect(row).toMatchObject({ widthMm: null, heightMm: null, lengthMm: null });
  });

  it('derives category-specific attributes from v4.4 processing names', () => {
    const [angleHole, squareHole, laserLeading, laserParenthesized, plateCut, bend, roundBar] =
      buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: 'ELH020',
          category: '加工/孔',
          subcategory: '角鐵',
          product_name: '冷鍍鋅角鐵沖孔 51mm*3.5 單*3M',
          normalized_spec_text: '冷鍍鋅角鐵沖孔 51mmx3.5 單x3M 2in 50.8mm',
          dimension_signature: 'in2',
          source_thickness: '',
          width_mm: '',
          length_mm: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'KADS06',
          category: '加工/孔',
          subcategory: '鐵板',
          product_name: '沖3/4□孔',
          normalized_spec_text: '沖3/4□孔',
          dimension_signature: '',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'BKZZM2',
          category: '加工/切工',
          subcategory: '鐵板',
          product_name: '2.0 雷射切割',
          normalized_spec_text: '2.0 雷射切割',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'BLZZM3',
          category: '加工/切工',
          subcategory: '鐵板',
          product_name: '雷射切割(3.0)',
          normalized_spec_text: '雷射切割(3.0)',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'DNB2002',
          category: '加工/切工',
          subcategory: 'H型鋼',
          product_name: '12.0-30.0mm板切φ',
          normalized_spec_text: '12.0-30.0mm板切φ t30mm',
          source_thickness: '30',
        }),
        makeWorkbookRow({
          erp_item_code: 'BKZA010',
          category: '加工/折工',
          subcategory: '鐵板',
          product_name: '板折  型(0.8-2.0)',
          normalized_spec_text: '板折  型(0.8-2.0)',
          source_thickness: '',
        }),
        makeWorkbookRow({
          erp_item_code: 'EQC0280',
          category: '圓條',
          subcategory: '',
          product_name: '磨光中碳光圓 28m/m',
          normalized_spec_text: '磨光中碳光圓 28mm',
          source_thickness: '',
          outer_diameter_mm: '',
        }),
      ]);

    expect(angleHole).toMatchObject({
      widthMm: 51,
      lengthMm: 3000,
      thicknessMinMm: 3.5,
      thicknessMaxMm: 3.5,
    });
    expect(squareHole).toMatchObject({ specKey: 'KADS06 沖3/4□孔' });
    expect(laserLeading).toMatchObject({ thicknessMinMm: 2, thicknessMaxMm: 2 });
    expect(laserParenthesized).toMatchObject({ thicknessMinMm: 3, thicknessMaxMm: 3 });
    expect(plateCut).toMatchObject({ thicknessMinMm: 12, thicknessMaxMm: 30 });
    expect(bend).toMatchObject({ thicknessMinMm: 0.8, thicknessMaxMm: 2 });
    expect(roundBar).toMatchObject({ outerDiameterMm: 28 });
  });

  it.each([
    ['磨光圓鐵 8.0 (6M)(2.5)', 8, null, 6000],
    ['磨光圓鐵 12.0(5.5)', 12, null, 6000],
    ['磨光圓鐵 20.0 (整支) 以過磅重計', 20, null, 6000],
    ['磨光圓鐵 35.0(整支) 以過磅重計', 35, null, 6000],
    ['白鐵圓鐵 3.0*3M', 3, null, 3000],
    ['白鐵圓鐵 5m/m*6M', 5, null, 6000],
    ['磨光圓鐵 1/4 (3M)', 6.35, '1/4', 3000],
    ['磨光圓鐵 1 (整支) 以過磅重計', 25.4, '1', 6000],
    ['磨光圓鐵 3/8 (6M)', 9.525, '3/8', 6000],
    ['磨光圓鐵 11/4 (整支) 以過磅重計', 31.75, '1 1/4', 6000],
    ['磨光圓鐵 13/4(整支) 以過磅重計', 44.45, '1 3/4', 6000],
  ])(
    'normalizes round-bar diameter and stock length from %s',
    (productName, outerDiameterMm, nominalInch, lengthMm) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `ROUND-${productName}`,
          category: '圓條',
          product_name: productName,
          normalized_spec_text: productName.replaceAll('m/m', 'mm'),
          source_thickness: '',
          outer_diameter_mm: '',
          nominal_inch: '',
          length_mm: '',
        }),
      ]);

      expect(row).toMatchObject({ outerDiameterMm, nominalInch, lengthMm });
    },
  );

  it('discards inferred pipe-inch aliases that are not present in the round-bar source name', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'ROUND-38',
        category: '圓條',
        product_name: '磨光圓鐵 38mm(整支) 以過磅重計',
        normalized_spec_text: '磨光圓鐵 38mm(整支) 以過磅重計 5.5in 139.7mm OD139.7mm',
        source_thickness: '',
        outer_diameter_mm: '38',
        nominal_inch: '5.5',
      }),
    ]);

    expect(row).toMatchObject({
      outerDiameterMm: 38,
      nominalInch: null,
    });
  });

  it('does not collapse round-bar cutting ranges into a single diameter', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'ROUND-RANGE',
        category: '圓條',
        product_name: '磨光圓鐵 12m/m-50m/m切',
        normalized_spec_text: '磨光圓鐵 12mm-50mm切',
        source_thickness: '',
        outer_diameter_mm: '',
        nominal_inch: '',
      }),
    ]);

    expect(row).toMatchObject({ outerDiameterMm: null, nominalInch: null });
  });

  it.each([
    ['黑A鋼管 13mm*1.5', 13, null, 1.5, 6000, null],
    ['白A鋼管 1/2*1.5', 12.7, '1/2', 1.5, 6000, null],
    ['鍍鋅B管 3/8*2.3(17)', 9.525, '3/8', 2.3, 6000, 17],
    ['熱浸鍍鋅美亞A管 11/2*2.0', 38.1, '1 1/2', 2, 6000, null],
    ['黑A鋼管 6"*3.0*7M', 152.4, '6', 3, 7000, null],
    ['白A鋼管 19mm*1.5*5900L', 19, null, 1.5, 5900, null],
  ])(
    'normalizes round-pipe source dimensions from %s',
    (productName, outerDiameterMm, nominalInch, thicknessMm, lengthMm, unitWeightValue) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `PIPE-${productName}`,
          category: '圓管',
          product_name: productName,
          normalized_spec_text: `${productName} 5.5in 139.7mm t5900mm`,
          source_thickness: '5900',
          outer_diameter_mm: '139.7',
          nominal_inch: '5.5',
          length_mm: '',
          unit_weight_value: '',
        }),
      ]);

      expect(row).toMatchObject({
        outerDiameterMm,
        nominalInch,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        lengthMm,
        unitWeightValue,
        unitWeightBasis: unitWeightValue === null ? 'M' : 'kg_per_piece_or_stock_length',
      });
    },
  );

  it.each([
    ['白鐵方管 3/4*0.8 BA', 19.05, '3/4', 0.8, 6000],
    ['黑鐵方管 5/8*1.5', 15.875, '5/8', 1.5, 6000],
    ['黑鐵方管 25mm*1.2', 25, null, 1.2, 6000],
    ['黑鐵方管 正40*2.0', 40, null, 2, 6000],
    ['黑鐵方管 200x6.0x6M', 200, null, 6, 6000],
    ['黑鐵方管 200x6.0x12M', 200, null, 6, 12000],
    ['黑鐵方管 51mm*1.5', 51, null, 1.5, 6000],
    ['黑鐵方管 3"*2.0', 76.2, '3', 2, 6000],
    ['錏方管3/4*1.5', 19.05, '3/4', 1.5, 6000],
    ['白鐵方管 1/2*1.2', 12.7, '1/2', 1.2, 6000],
  ])(
    'normalizes ordinary square-tube dimensions from %s',
    (productName, sideMm, nominalInch, thicknessMm, lengthMm) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `SQUARE-TUBE-${productName}`,
          category: '方管',
          product_name: productName,
          normalized_spec_text: `${productName} polluted t480mm L2000mm`,
          source_thickness: '480',
          width_mm: '110',
          height_mm: '110',
          length_mm: '2000',
          nominal_inch: '11',
        }),
      ]);

      expect(row).toMatchObject({
        widthMm: sideMm,
        heightMm: sideMm,
        nominalInch,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        lengthMm,
      });
    },
  );

  it.each([
    ['黑鐵扁方管 100x200x4.0', 100, 200, 4, 6000],
    ['錏扁方管 15x30x1.5', 15, 30, 1.5, 6000],
    ['錏扁方管 20* 40*1.2', 20, 40, 1.2, 6000],
    ['白鐵扁方管 13x26x0.9', 13, 26, 0.9, 6000],
    ['黑鐵扁方管 100x200x4.0x12M', 100, 200, 4, 12000],
    ['白鐵扁方管 10x20x6M', 10, 20, null, 6000],
  ])(
    'normalizes rectangular-tube dimensions from %s',
    (productName, widthMm, heightMm, thicknessMm, lengthMm) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `RECTANGULAR-TUBE-${productName}`,
          category: '扁方管',
          product_name: productName,
          normalized_spec_text: `${productName} polluted t12mm L2000mm`,
          source_thickness: '12',
          width_mm: '999',
          height_mm: '999',
          length_mm: '2000',
        }),
      ]);

      expect(row).toMatchObject({
        widthMm,
        heightMm,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        lengthMm,
      });
    },
  );

  it.each([
    ['槽鐵50x25x5.0x6M(22)', '黑鐵 / OT', 50, 25, 5, 5, 6000, 22],
    ['熱浸鍍槽鐵75x40x5/7x6M(44.0)', '錏/鍍鋅', 75, 40, 5, 7, 6000, 44],
    ['白鐵槽鐵100x50x5.0(台製)', '白鐵 / ST', 100, 50, 5, 5, 6000, null],
    ['熱浸鍍鋅槽鐵200x80x12M(310)', '錏/鍍鋅', 200, 80, null, null, 12000, 310],
  ])(
    'normalizes channel dimensions, material, stock length, and weight from %s',
    (productName, material, heightMm, widthMm, webMm, flangeMm, lengthMm, unitWeightValue) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `CHANNEL-${productName}`,
          category: '槽鐵',
          product_name: productName,
          normalized_spec_text: `${productName} polluted t12mm L2000mm`,
          material: productName.includes('熱浸鍍') ? '黑鐵 / OT' : material,
          source_thickness: '12',
          width_mm: '999',
          height_mm: '999',
          length_mm: '2000',
          web_mm: '12',
          flange_mm: '12',
          unit_weight_value: unitWeightValue === null ? '' : '999',
          unit_weight_basis: unitWeightValue === null ? '' : 'unknown',
        }),
      ]);

      expect(row).toMatchObject({
        material,
        heightMm,
        widthMm,
        webMm,
        flangeMm,
        thicknessMinMm: webMm,
        thicknessMaxMm: webMm,
        lengthMm,
        unitWeightValue,
        unitWeightBasis: unitWeightValue === null ? null : 'kg_per_piece_or_stock_length',
      });
    },
  );

  it.each([
    ['白鐵角鐵25 x2.0(4.88)BA', '白鐵亮面 / ST BA', '', 25, 25, 2, 6000, 4.88],
    ['不等邊黑角鐵100x75x7.0x6M(56)', '黑鐵 / OT', '不等邊', 100, 75, 7, 6000, 56],
    ['黑角鐵25x2.5(7.6)x8M', '黑鐵 / OT', '', 25, 25, 2.5, 8000, 7.6],
    ['黑角鐵130x9.0(107.5)進口', '黑鐵 / OT', '', 130, 130, 9, 6000, 107.5],
    ['烤漆萬能角鋼52x32x1.6x12尺', '黑鐵 / OT', '萬能/成型', 52, 32, 1.6, 3636, null],
    ['錏成型角鐵25x2.5x6M(5.7)', '錏', '', 25, 25, 2.5, 6000, 5.7],
    ['不等邊熱進鍍鋅角鐵100x75x7.0x6M', '錏/鍍鋅', '不等邊', 100, 75, 7, 6000, null],
    ['白鐵角鐵25 x2.0(4.4)2B', '白鐵霧面 / ST 2B', '', 25, 25, 2, 6000, 4.4],
  ])(
    'normalizes angle dimensions, material, stock length, and weight from %s',
    (
      productName,
      material,
      subcategory,
      heightMm,
      widthMm,
      thicknessMm,
      lengthMm,
      unitWeightValue,
    ) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `ANGLE-${productName}`,
          category: '角鐵',
          subcategory,
          product_name: productName,
          normalized_spec_text: `${productName} polluted t25mm L6000mm`,
          material,
          source_thickness: '25',
          width_mm: '999',
          height_mm: '999',
          length_mm: '6000',
          unit_weight_value: unitWeightValue === null ? '' : '999',
          unit_weight_basis: unitWeightValue === null ? '' : 'unknown',
        }),
      ]);

      expect(row).toMatchObject({
        material,
        heightMm,
        widthMm,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        lengthMm,
        unitWeightValue,
        unitWeightBasis: unitWeightValue === null ? null : 'kg_per_piece_or_stock_length',
      });
    },
  );

  it('does not apply the angle 6M default to angle accessories', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'ANGLE-ACCESSORY',
        category: '角鐵',
        subcategory: '配件',
        product_name: '萬能角鋼用塑膠腳套(右)',
        normalized_spec_text: '萬能角鋼用塑膠腳套(右)',
        width_mm: '',
        height_mm: '',
        source_thickness: '',
      }),
    ]);

    expect(row).toMatchObject({
      widthMm: null,
      heightMm: null,
      thicknessMinMm: null,
      lengthMm: null,
    });
  });

  it.each([
    ['點焊鋼絲網5.5 15x15 2Mx3M(6)', '點焊', 150, 150, 5.5, 3000, 2000, 3000, null],
    ['點焊鋼絲網6.0足 15x15 2Mx3M(6)', '點焊', 150, 150, 6, 3000, 2000, 3000, null],
    ['ST網2尺x100尺33#(0.2)16目(1.6)', '鐵網', 1.6, 1.6, 0.2, 30300, 606, 30300, null],
    ['ST網4尺x100尺(16目)', '鐵網', null, null, null, 30300, 1212, 30300, null],
    ['牛筋網2尺', '牛筋', null, null, null, null, 606, null, null],
    ['黑鐵刺網105M(8.2KG)', '刺網', null, null, null, 105000, null, null, 8.2],
    ['白鐵刀刺網(蛇腹型) φ500 可拉6 -8 M', '刺網', null, null, null, 8000, null, null, null],
    ['鍍鋅高床網5.4x(17mmx46mm長方孔)', '高床', 17, 46, 5.4, null, null, null, null],
    ['鍍鋅菱形網 8#(3.6)x51mm(60mm) ◇孔', '菱形', 60, 60, 3.6, null, null, null, null],
    ['錏浪型網 10#(3.0)x25mm □孔', '浪型', 25, 25, 3, null, null, null, null],
  ])(
    'normalizes mesh attributes from %s',
    (
      productName,
      subcategory,
      widthMm,
      heightMm,
      thicknessMm,
      lengthMm,
      sheetWidthMm,
      sheetLengthMm,
      unitWeightValue,
    ) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `MESH-${productName}`,
          category: '網',
          subcategory: productName.includes('浪型網') ? '浪型網' : subcategory,
          product_name: productName,
          normalized_spec_text: `${productName} polluted t304mm`,
          source_thickness: '304',
          width_mm: '999',
          height_mm: '999',
          length_mm: '',
          sheet_width_mm: '999',
          sheet_length_mm: '999',
          unit_weight_value: productName.startsWith('點焊鋼絲網') ? '6' : '999',
          unit_weight_basis: 'unknown',
        }),
      ]);

      expect(row).toMatchObject({
        subcategory,
        widthMm,
        heightMm,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        lengthMm,
        sheetWidthMm,
        sheetLengthMm,
        unitWeightValue,
        unitWeightBasis: unitWeightValue === null ? null : 'kg_per_piece_or_stock_length',
      });
    },
  );

  it('preserves a valid workbook subcategory instead of replacing an explicit correction', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'MESH-MANUAL',
        category: '網',
        subcategory: '菱形',
        product_name: '錏浪型網 10#(3.0)x25mm □孔',
      }),
    ]);

    expect(row?.subcategory).toBe('菱形');
  });

  it('does not parse ST304 mesh accessory grade as thickness', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'MESH-ACCESSORY',
        category: '網',
        subcategory: '配件',
        product_name: '鐵網的固定片(ST304) /200片/包',
        normalized_spec_text: '鐵網的固定片(ST304) /200片/包 t304mm',
        source_thickness: '304',
      }),
    ]);

    expect(row).toMatchObject({
      thicknessMinMm: null,
      thicknessMaxMm: null,
      widthMm: null,
      heightMm: null,
    });
  });

  it.each([
    ['節竹鐵 9m/m (3#)', 9],
    ['節竹鐵 12m/m (4#)', 12],
  ])('normalizes rebar diameter and number from %s', (productName, diameterMm) => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: `REBAR-${diameterMm}`,
        category: '鋼筋',
        product_name: productName,
        normalized_spec_text: productName.replace('m/m', 'mm'),
        outer_diameter_mm: '999',
        source_thickness: '999',
        length_mm: '',
        unit_weight_value: '',
      }),
    ]);

    expect(row).toMatchObject({
      outerDiameterMm: diameterMm,
      thicknessMinMm: null,
      thicknessMaxMm: null,
      lengthMm: null,
      unitWeightValue: null,
    });
  });

  it.each([
    ['6K鐵軌 6M(38)(件55支)凸面22.0非25.4', 'rail6k|l6000', 6000, 38, 'confirmed'],
    ['6 K鐵軌(33)5.5M特殊--勿用', 'rail6k|l5500', 5500, 33, 'no_price'],
    ['9K鐵軌 6M(54)', 'rail9k|l6000', 6000, 54, 'confirmed'],
    ['12K鐵軌 10M(122)', 'rail12k|l10000', 10000, 122, 'confirmed'],
  ])(
    'normalizes rail grade, explicit stock length, and piece weight from %s',
    (productName, signature, lengthMm, unitWeightValue, valueState) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `RAIL-${signature}`,
          category: '鐵軌',
          product_name: productName,
          normalized_spec_text: `${productName} polluted t25.4mm`,
          dimension_signature: 'polluted',
          source_thickness: '25.4',
          length_mm: '999',
          unit_weight_value: '36',
          unit_weight_basis: 'kg_per_stock_length',
        }),
      ]);

      expect(row).toMatchObject({
        thicknessMinMm: null,
        thicknessMaxMm: null,
        lengthMm,
        unitWeightValue,
        unitWeightBasis: 'kg_per_piece_or_stock_length',
        valueState,
      });
    },
  );

  it('keeps a generic rail name without an invented grade, length, or weight', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: 'RAIL-GENERIC',
        category: '鐵軌',
        product_name: '鐵軌',
        normalized_spec_text: '鐵軌',
        dimension_signature: '',
        length_mm: '',
        unit_weight_value: '',
      }),
    ]);

    expect(row).toMatchObject({
      lengthMm: null,
      unitWeightValue: null,
    });
  });

  it.each([
    ['一體成型太陽片25mm方管3溝08S-3', 25, null],
    ['ST25mm方管雨棚架BA 2尺', 25, null],
    ['ST11/4方管雨棚BA 2尺5', 31.75, '1 1/4'],
    ['白鐵方管11/4*3/4沖孔窗雙內80', 31.75, '1 1/4'],
    ['3/4白鐵方管連料 U型110*480', 19.05, '3/4'],
    ['25mm白鐵方管連料 U型135*725', 25, null],
    ['25mm白鐵方管連料 1尺4', 25, null],
  ])(
    'keeps finished square-tube dimensions out of material thickness for %s',
    (productName, sideMm, nominalInch) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `SQUARE-TUBE-SPECIAL-${productName}`,
          category: '方管',
          product_name: productName,
          normalized_spec_text: `${productName} 110x480mm t480mm`,
          source_thickness: '480',
          width_mm: '110',
          height_mm: '110',
          nominal_inch: '11',
        }),
      ]);

      expect(row).toMatchObject({
        widthMm: sideMm,
        heightMm: sideMm,
        nominalInch,
        thicknessMinMm: null,
        thicknessMaxMm: null,
        lengthMm: 6000,
      });
    },
  );

  it.each([
    ['平鐵', '黑鐵平鐵32*16(24.2)特殊'],
    ['角鐵', '黑角鐵40*4.0(14.3)'],
    ['圓管', '黑A鋼管 13mm*1.5'],
    ['圓條', '圓鐵12m/m(1/2)(5.5)'],
    ['扁方管', '黑鐵扁方管 45*75*2.3'],
    ['方管', '錏方管100*2.0'],
    ['槽鐵', '白鐵槽鐵100*50*5.0(台製)'],
  ])('defaults %s product names without a length to 6000mm', (category, productName) => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: `LONG-${category}`,
        category,
        product_name: productName,
        normalized_spec_text: productName.replaceAll('*', 'x'),
        source_thickness: '',
        length_mm: '9000',
      }),
    ]);

    expect(row?.lengthMm).toBe(6000);
  });

  it.each([
    ['黑鐵平鐵16*3.0(1.8)*5M', 5000],
    ['黑A鋼管 19mm*1.5*5900L', 5900],
  ])('uses the explicit product-name length from %s', (productName, lengthMm) => {
    const category = productName.includes('平鐵') ? '平鐵' : '圓管';
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        erp_item_code: `LONG-EXPLICIT-${lengthMm}`,
        category,
        product_name: productName,
        normalized_spec_text: productName.replaceAll('*', 'x'),
        source_thickness: '',
        length_mm: '6000',
      }),
    ]);

    expect(row?.lengthMm).toBe(lengthMm);
  });

  it.each([
    ['黑鐵平鐵16*3.0(2.12)*6M', 16, 3, 2.12, 6000],
    ['黑鐵平鐵32*16(24.2)特殊', 32, 16, 24.2, 6000],
    ['白鐵平鐵 5/8*2.0 (1.5)', 15.875, 2, 1.5, 6000],
  ])(
    'normalizes flat-bar dimensions and stock weight from %s',
    (productName, widthMm, thicknessMm, unitWeightValue, lengthMm) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `FLAT-${productName}`,
          category: '平鐵',
          product_name: productName,
          normalized_spec_text: productName.replaceAll('*', 'x'),
          source_thickness: '',
          width_mm: '8',
          length_mm: '',
          unit_weight_value: '2.1',
          unit_weight_basis: 'unknown',
        }),
      ]);

      expect(row).toMatchObject({
        widthMm,
        thicknessMinMm: thicknessMm,
        thicknessMaxMm: thicknessMm,
        unitWeightValue,
        unitWeightBasis: 'kg_per_piece_or_stock_length',
        lengthMm,
      });
    },
  );

  it.each([
    ['3/4白鐵圓管連料100*480', 19.05, '3/4'],
    ['一體成型太陽片3/4圓管3溝06C-3', 19.05, '3/4'],
  ])(
    'does not treat special round-pipe product dimensions as wall thickness for %s',
    (productName, diameter, inch) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `PIPE-SPECIAL-${productName}`,
          category: '圓管',
          product_name: productName,
          normalized_spec_text: `${productName} 100x480mm OD100mm t480mm`,
          source_thickness: '480',
          outer_diameter_mm: '100',
          nominal_inch: '',
        }),
      ]);

      expect(row).toMatchObject({
        outerDiameterMm: diameter,
        nominalInch: inch,
        thicknessMinMm: null,
        thicknessMaxMm: null,
      });
    },
  );

  it('accepts ratio_only rows only when prices are absent and a ratio exists', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        value_state: 'ratio_only',
        unit_price_a: '0',
        unit_price_b: '0',
        unit_price_c: '0',
        unit_price_f: '0',
        price_ratio_b: '1.25',
      }),
    ]);

    expect(row).toMatchObject({
      valueState: 'ratio_only',
      unitPriceA: null,
      unitPriceB: null,
      unitPriceC: null,
      unitPriceF: null,
      priceRatioB: 1.25,
    });
    expect(() =>
      buildSteelPriceV4Rows([makeWorkbookRow({ value_state: 'ratio_only', unit_price_a: '100' })]),
    ).toThrow('ratio_only');
  });

  it('accepts no_price rows only when both prices and ratios are absent', () => {
    const [row] = buildSteelPriceV4Rows([
      makeWorkbookRow({
        value_state: 'no_price',
        unit_price_a: '0',
        unit_price_b: '0',
        unit_price_c: '0',
        unit_price_f: '0',
        price_ratio_b: '0',
        price_ratio_c: '0',
      }),
    ]);

    expect(row).toMatchObject({
      valueState: 'no_price',
    });
    expect(() =>
      buildSteelPriceV4Rows([makeWorkbookRow({ value_state: 'no_price', price_ratio_a: '1.1' })]),
    ).toThrow('no_price');
  });

  it.each(['沒做', '勿用', '沒出', '沒貨', '不生產', '無生產', '不用', '沒現貨'])(
    'forces product names containing %s to no_price and clears every price value',
    (marker) => {
      const [row] = buildSteelPriceV4Rows([
        makeWorkbookRow({
          erp_item_code: `SUPPRESSED-${marker}`,
          product_name: `測試品項-${marker}`,
          value_state: 'confirmed',
          unit_price_a: '100',
          unit_price_b: '90',
          price_ratio_a: '1.5',
        }),
      ]);

      expect(row).toMatchObject({
        valueState: 'no_price',
        unitPriceA: null,
        unitPriceB: null,
        priceRatioA: null,
      });
      expect([
        row?.unitPriceBase,
        row?.unitPriceA,
        row?.unitPriceB,
        row?.unitPriceC,
        row?.unitPriceD,
        row?.unitPriceE,
        row?.unitPriceF,
        row?.priceRatioA,
        row?.priceRatioB,
        row?.priceRatioC,
        row?.priceRatioD,
        row?.priceRatioE,
        row?.priceRatioF,
      ]).toEqual(Array(13).fill(null));
    },
  );

  it('requires confirmed rows to contain at least one price', () => {
    expect(() =>
      buildSteelPriceV4Rows([
        makeWorkbookRow({
          unit_price_a: '0',
          unit_price_b: '0',
          unit_price_c: '0',
          unit_price_f: '0',
        }),
      ]),
    ).toThrow('confirmed');
  });

  it('rejects unknown categories and corrects stale subcategories from category plus product name', () => {
    expect(() => buildSteelPriceV4Rows([makeWorkbookRow({ category: '未知' })])).toThrow(
      'Unknown Steel price category: 未知',
    );
    expect(
      buildSteelPriceV4Rows([
        makeWorkbookRow({ category: 'T型鋼', subcategory: 'H型鋼', product_name: 'T型鋼' }),
      ])[0]?.subcategory,
    ).toBe('標準');
  });
});
