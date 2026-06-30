import { compareDrawingEvidenceRows } from './compare';
import { steelDrawingEvidenceResultSchema } from './schema';

const expected = {
  sourceFile: 'synthetic-drawing.pdf',
  rows: [
    {
      name: '主材',
      partNo: 'A1',
      spec: '100×200×9t',
      quantity: 2,
      boltSize: 'M16',
      boltTotalExpression: '4×2=8',
      boltTotal: 8,
    },
    {
      name: '補強材',
      partNo: 'A2',
      spec: '80×120×6t',
      quantity: 3,
      boltSize: 'M12',
      boltTotalExpression: '2×3=6',
      boltTotal: 6,
    },
  ],
};

describe('Steel drawing evidence comparison', () => {
  it('validates a drawing schedule fixture shape', () => {
    const parsed = steelDrawingEvidenceResultSchema.parse(expected);

    expect(parsed.rows).toHaveLength(2);
    expect(new Set(parsed.rows.map((row) => row.partNo)).size).toBe(2);
    expect(parsed.rows.every((row) => row.boltTotalExpression.endsWith(`=${row.boltTotal}`))).toBe(
      true,
    );
  });

  it('compares extracted rows against the expected fixture', () => {
    const actual = steelDrawingEvidenceResultSchema.parse(expected);
    const result = compareDrawingEvidenceRows({ expected, actual });

    expect(result.fieldAccuracy).toBe(1);
    expect(result.mismatches).toEqual([]);
  });

  it('normalizes multiplication symbols and reports row-level mismatches', () => {
    const actual = steelDrawingEvidenceResultSchema.parse({
      ...expected,
      rows: expected.rows.map((row) =>
        row.partNo === 'A1'
          ? {
              ...row,
              spec: '100x200x9t',
              boltTotalExpression: '4*2=8',
            }
          : row,
      ),
    });
    const changed = steelDrawingEvidenceResultSchema.parse({
      ...expected,
      rows: expected.rows.map((row) =>
        row.partNo === 'A2'
          ? {
              ...row,
              quantity: 4,
            }
          : row,
      ),
    });

    expect(compareDrawingEvidenceRows({ expected, actual }).mismatches).toEqual([]);
    expect(compareDrawingEvidenceRows({ expected, actual: changed })).toEqual(
      expect.objectContaining({
        fieldAccuracy: expect.any(Number),
        mismatches: [
          expect.objectContaining({
            partNo: 'A2',
            field: 'quantity',
            expected: 3,
            actual: 4,
          }),
        ],
      }),
    );
  });
});
