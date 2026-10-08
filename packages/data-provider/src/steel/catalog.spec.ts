import type { SteelCatalogCandidate } from './catalog';
import type { SteelReviewLedgerRow } from './review';
import { applyMaterialCandidate, applyProcessingCandidate, steelCatalogOptionLabel } from './catalog';
import { applySteelReviewOperations } from './review';

const candidate: SteelCatalogCandidate = {
  id: '9007199254740993',
  revision: 'a'.repeat(64),
  erpItemCode: 'SC-UNIQUE',
  productName: 'Selector steel plate',
  specKey: 'catalog-special 400mm',
  category: '鐵板',
  subcategory: null,
  formulaCode: 'plate-v1',
  material: 'SS400',
  unit: 'kg',
  costBasis: 'kg',
  valueState: 'confirmed',
  unitWeightValue: null,
  unitWeightBasis: null,
  density: '7.85',
  thicknessMinMm: '2',
  thicknessMaxMm: '6',
  widthMm: '400',
  heightMm: null,
  lengthMm: null,
  outerDiameterMm: null,
  webMm: null,
  flangeMm: null,
  lipMm: null,
  sheetWidthMm: null,
  sheetLengthMm: null,
  unitPrice: null,
  calculation: {
    erpItemCode: 'SC-UNIQUE',
    category: '鐵板',
    ruleVersion: 'steel-catalog-v1',
    exactPhysical: { density: '7.85' },
  },
  label: 'SC-UNIQUE Selector steel plate',
};

const row = (rowId: string, kind: 'material' | 'processing'): SteelReviewLedgerRow => ({
  rowId,
  origin: 'ai',
  deleted: false,
  source: { fileId: 'drawing-1', pageNumber: 2, filename: 'drawing.pdf', mediaType: 'application/pdf' },
  system: kind === 'material'
    ? { kind, parentRowId: null, cascadeDeletedBy: null }
    : { kind, parentRowId: 'material-1', cascadeDeletedBy: null },
  values: {
    型號: { baseline: 'OLD', effective: 'OLD' },
    品名規格: { baseline: 'old description', effective: 'old description' },
    材質編號: { baseline: 'A36', effective: 'A36' },
    類別: { baseline: '鐵板', effective: '鐵板' },
    單位: { baseline: 'kg', effective: 'kg' },
    計價基準: { baseline: '4', effective: '4' },
    數量: { baseline: '3', effective: '3' },
    單價: { baseline: '7', effective: '7' },
    厚度: { baseline: '4', effective: '4' },
    寬度: { baseline: '100', effective: '100' },
    長度: { baseline: '200', effective: '200' },
    備註: { baseline: 'keep', effective: 'keep' },
  },
});

describe('Steel catalog candidate application', () => {
  it('labels with ERP and product name while saving only the product name', () => {
    expect(steelCatalogOptionLabel(candidate)).toBe('SC-UNIQUE Selector steel plate');
    const material = row('material-1', 'material');
    const processing = row('processing-1', 'processing');
    const applied = applyMaterialCandidate(material, candidate, Object.keys(material.values), 'B');

    expect(applied.values['型號']?.effective).toBe('SC-UNIQUE');
    expect(applied.values['品名規格']?.effective).toBe('Selector steel plate');
    expect(applied.values['材質編號']?.effective).toBe('SS400');
    expect(applied.values['計價基準']?.effective).toBe('2');
    expect(applied.values['單價']?.effective).toBe('');
    expect(applied.values['數量']?.effective).toBe('3');
    expect(applied.values['厚度']?.effective).toBe('');
    expect(applied.source).toEqual(material.source);
    expect(processing.values).toEqual(row('processing-1', 'processing').values);
  });
});

it('merges a candidate over independent quantity and source changes', () => {
  const expected = row('material-1', 'material');
  const current = { ...expected, source: { ...expected.source!, pageNumber: 3 },
    values: { ...expected.values, 數量: { baseline: '3', effective: '5' } } };
  const processing = row('processing-1', 'processing');
  const result = applySteelReviewOperations({
    headers: Object.keys(expected.values),
    currentRows: [current, processing], expectedRows: [expected, processing],
    operations: [{ type: 'replace_material', rowId: expected.rowId, selection: {
      id: candidate.id, revision: candidate.revision,
      evidence: { snapshotId: 'snapshot', revision: 'customer', tier: 'B' },
    } }], materialCandidates: new Map([[expected.rowId, candidate]]),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Independent candidate changes did not merge');
  expect(result.currentRows[0].values['數量'].effective).toBe('5');
  expect(result.currentRows[0].source).toEqual(current.source);
  expect(result.currentRows[1]).toEqual({ ...processing, source: current.source });
});

it('accepts an explicit material add followed by candidate replacement and later dimension and quantity edits', () => {
  const pricedCandidate: SteelCatalogCandidate = {
    ...candidate,
    thicknessMinMm: '2',
    thicknessMaxMm: '2',
    widthMm: '100',
    lengthMm: '200',
    unitPrice: '2',
  };
  const headers = [
    '型號', '品名規格', '類別', '材質編號', '單位', '計價基準', '公式編號',
    '厚度', '寬度', '長度', '單重', '單價', '數量', '總數',
  ];
  const result = applySteelReviewOperations({
    headers,
    currentRows: [],
    expectedRows: [],
    operations: [
      {
        type: 'add',
        rowId: 'material-added',
        position: { kind: 'end' },
        system: { kind: 'material', parentRowId: null },
        changes: [
          { header: '類別', value: '鐵板' },
          { header: '數量', value: '3' },
          { header: '寬度', value: '100' },
          { header: '長度', value: '200' },
        ],
      },
      {
        type: 'replace_material',
        rowId: 'material-added',
        selection: {
          id: pricedCandidate.id,
          revision: pricedCandidate.revision,
          evidence: { snapshotId: 'snapshot', revision: 'customer', tier: 'B' },
        },
      },
      {
        type: 'update',
        rowId: 'material-added',
        changes: [{ header: '厚度', value: '3' }, { header: '數量', value: '4' }],
      },
    ],
    materialCandidates: new Map([['material-added', pricedCandidate]]),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Added material candidate replacement did not apply');
  const material = result.currentRows.find((row) => row.rowId === 'material-added');
  expect(material).toMatchObject({
    system: { kind: 'material' },
    calculation: { candidate: pricedCandidate.calculation },
  });
  expect(material?.values['型號']?.effective).toBe('SC-UNIQUE');
  expect(material?.values['單價']?.effective).toBe('2');
  expect(material?.values['數量']?.effective).toBe('4');
  expect(material?.values['單重']?.effective).toBe('0.471');
  expect(material?.values['總數']?.effective).toBe('1.884');
});

it('keeps explicit processing measurement, total, and binding when selecting a new candidate', () => {
  const parent = row('material-1', 'material');
  const processing = row('processing-1', 'processing');
  processing.values['總數'] = { baseline: '99', effective: '99' };
  processing.calculation = { measurement: { mode: 'perPiece', amount: '2.5', unit: '次' } };
  const nextCandidate: SteelCatalogCandidate = { ...candidate, category: '加工/孔', subcategory: '鐵板',
    erpItemCode: 'HOLE-1', unit: '次', unitPrice: '1.234567890123456789',
    calculation: { erpItemCode: 'HOLE-1', category: '加工/孔', ruleVersion: 'steel-catalog-v1', exactPhysical: {} } };
  const applied = applyProcessingCandidate(processing, nextCandidate, Object.keys(processing.values), 'B', parent);
  expect(applied.values['總數']?.effective).toBe('99');
  expect(applied.values['單價']?.effective).toBe('1.234567890123456789');
  expect(applied.calculation?.measurement).toEqual(processing.calculation.measurement);
  expect(applied.system).toEqual(processing.system);
  expect(applied.source).toEqual(processing.source);
  expect(applied.values['數量']?.effective).toBe('3');
});

it('checks a processing selection against the material after ordered draft edits', () => {
  const parent = row('material-1', 'material');
  const child = row('processing-1', 'processing');
  child.values['總數'] = { baseline: '99', effective: '99' };
  child.calculation = { measurement: { mode: 'perPiece', amount: '2.5', unit: '次' } };
  const selected: SteelCatalogCandidate = { ...candidate, category: '加工/孔', subcategory: 'C型鋼', unit: '次',
    erpItemCode: 'HOLE-C', calculation: { erpItemCode: 'HOLE-C', category: '加工/孔', ruleVersion: 'steel-catalog-v1', exactPhysical: {} } };
  const selection = { id: selected.id, revision: selected.revision,
    evidence: { snapshotId: 'snapshot', revision: 'customer', tier: 'B' as const } };
  const input = { headers: Object.keys(child.values), currentRows: [parent, child], expectedRows: [parent, child],
    processingCandidates: new Map([[child.rowId, selected]]) };
  const rejected = applySteelReviewOperations({ ...input,
    operations: [{ type: 'replace_processing', rowId: child.rowId, selection }] });
  expect(rejected.ok).toBe(false);
  const accepted = applySteelReviewOperations({ ...input, operations: [
    { type: 'update', rowId: parent.rowId, changes: [{ header: '類別', value: 'C型鋼' }] },
    { type: 'replace_processing', rowId: child.rowId, selection },
  ] });
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) throw new Error('Staged material category did not authorize processing');
  expect(accepted.currentRows[1].values['總數']?.effective).toBe('99');
  expect(accepted.currentRows[1].values['單價']?.effective).toBe('');
  expect(accepted.currentRows[1].system?.parentRowId).toBe(parent.rowId);
});

const protectedHeaders = ['寬度', '長度', '肚', '外徑', '腹板', '翼板', '唇邊', '單重', '數量', '總數', '備註'];
const populatedRow = (kind: 'material' | 'processing'): SteelReviewLedgerRow => {
  const original = row(kind === 'material' ? 'material-1' : 'processing-1', kind);
  original.values = {
    ...original.values,
    公式編號: { baseline: 'old-formula', effective: 'old-formula' },
    ...Object.fromEntries(protectedHeaders.map((header, index) => [header, {
      baseline: `baseline-${index}`, effective: header === '備註' ? 'keep' : String(index + 10),
    }])),
  };
  original.calculation = {
    measurement: { mode: 'perPiece', amount: '2.5', unit: '次' },
    fields: Object.fromEntries(protectedHeaders.map((header) => [header, { kind: 'manual' as const }])),
  };
  return original;
};
const populatedCandidate: SteelCatalogCandidate = {
  ...candidate, unitPrice: '12', thicknessMinMm: '15', thicknessMaxMm: '15',
  widthMm: '999', lengthMm: '998', heightMm: '997', outerDiameterMm: '996',
  webMm: '995', flangeMm: '994', lipMm: '993', unitWeightValue: '992',
};

it.each(['A', 'B', 'C', 'D', 'E', 'F'] as const)('writes only nine candidate fields using customer tier %s', (tier) => {
  for (const kind of ['material', 'processing'] as const) {
    const original = populatedRow(kind);
    const selected = kind === 'material' ? populatedCandidate : {
      ...populatedCandidate, category: '加工/孔', subcategory: '鐵板',
    };
    const applied = kind === 'material'
      ? applyMaterialCandidate(original, selected, Object.keys(original.values), tier)
      : applyProcessingCandidate(original, selected, Object.keys(original.values), tier, row('material-1', 'material'));
    expect(Object.fromEntries(Object.entries(applied.values).filter(([header]) => !protectedHeaders.includes(header)))).toEqual({
      型號: { baseline: 'OLD', effective: 'SC-UNIQUE' },
      品名規格: { baseline: 'old description', effective: 'Selector steel plate' },
      材質編號: { baseline: 'A36', effective: 'SS400' },
      類別: { baseline: '鐵板', effective: selected.category },
      單位: { baseline: 'kg', effective: 'kg' },
      計價基準: { baseline: '4', effective: String(tier.charCodeAt(0) - 64) },
      單價: { baseline: '7', effective: '12' },
      厚度: { baseline: '4', effective: '15' },
      公式編號: { baseline: 'old-formula', effective: 'plate-v1' },
    });
    for (const header of protectedHeaders) {
      expect(applied.values[header]).toEqual(original.values[header]);
      expect(applied.calculation?.fields?.[header]).toEqual(original.calculation?.fields?.[header]);
    }
    expect(applied.calculation?.measurement).toEqual(original.calculation?.measurement);
    expect(applied.calculation?.candidate).toEqual(selected.calculation);
  }
});

it.each(['material', 'processing'] as const)('preserves concurrent protected values and provenance during %s replacement', (kind) => {
  const original = populatedRow(kind);
  const current: SteelReviewLedgerRow = { ...original, values: { ...original.values,
    總數: { baseline: original.values['總數'].baseline, effective: '12345' },
    寬度: { baseline: original.values['寬度'].baseline, effective: '777' },
  } };
  const parent = row('material-1', 'material');
  const selected = kind === 'material' ? populatedCandidate : {
    ...populatedCandidate, category: '加工/孔', subcategory: '鐵板',
  };
  const result = applySteelReviewOperations({
    headers: Object.keys(original.values),
    currentRows: kind === 'material' ? [current] : [parent, current],
    expectedRows: kind === 'material' ? [original] : [parent, original],
    operations: [{ type: kind === 'material' ? 'replace_material' : 'replace_processing', rowId: original.rowId,
      selection: { id: selected.id, revision: selected.revision,
        evidence: { snapshotId: 'snapshot', revision: 'customer', tier: 'B' } } }],
    materialCandidates: new Map([[original.rowId, selected]]),
    processingCandidates: new Map([[original.rowId, selected]]),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Protected concurrent values conflicted with candidate selection');
  const applied = result.currentRows.find(({ rowId }) => rowId === original.rowId)!;
  for (const header of protectedHeaders) {
    expect(applied.values[header]).toEqual(current.values[header]);
    expect(applied.calculation?.fields?.[header]).toEqual(current.calculation?.fields?.[header]);
  }
});
