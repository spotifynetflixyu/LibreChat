import type { SteelCatalogCandidate } from './catalog';
import type { SteelReviewLedgerRow } from './review';
import { applyMaterialCandidate, steelCatalogOptionLabel } from './catalog';
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
  label: 'SC-UNIQUE Selector steel plate catalog-special 400mm',
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
  it('labels with ERP and full description while saving the description separately', () => {
    expect(steelCatalogOptionLabel(candidate)).toBe('SC-UNIQUE Selector steel plate catalog-special 400mm');
    const material = row('material-1', 'material');
    const processing = row('processing-1', 'processing');
    const applied = applyMaterialCandidate(material, candidate, Object.keys(material.values), 'B');

    expect(applied.values['型號']?.effective).toBe('SC-UNIQUE');
    expect(applied.values['品名規格']?.effective).toBe('Selector steel plate catalog-special 400mm');
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
  expect(result.currentRows[1]).toEqual(processing);
});
