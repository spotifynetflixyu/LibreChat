import expected from './fixtures/c.expected.json';
import { compareDrawingEvidenceRows } from './compare';
import { steelDrawingEvidenceResultSchema } from './schema';

describe('Steel drawing evidence comparison', () => {
  it('validates the c.png expected drawing schedule fixture', () => {
    const parsed = steelDrawingEvidenceResultSchema.parse(expected);

    expect(parsed.rows).toHaveLength(26);
    expect(new Set(parsed.rows.map((row) => row.partNo)).size).toBe(26);
    expect(parsed.rows.every((row) => row.boltTotalExpression.endsWith(`=${row.boltTotal}`))).toBe(
      true,
    );
  });

  it('compares extracted rows against the expected c.png fixture', () => {
    const actual = steelDrawingEvidenceResultSchema.parse(expected);
    const result = compareDrawingEvidenceRows({ expected, actual });

    expect(result.fieldAccuracy).toBe(1);
    expect(result.mismatches).toEqual([]);
  });

  it('normalizes multiplication symbols and reports row-level mismatches', () => {
    const actual = steelDrawingEvidenceResultSchema.parse({
      ...expected,
      rows: expected.rows.map((row) =>
        row.partNo === 'PL1'
          ? {
              ...row,
              spec: '367x323x12t',
              boltTotalExpression: '23*6=138',
            }
          : row,
      ),
    });
    const changed = steelDrawingEvidenceResultSchema.parse({
      ...expected,
      rows: expected.rows.map((row) =>
        row.partNo === 'PL2'
          ? {
              ...row,
              quantity: 37,
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
            partNo: 'PL2',
            field: 'quantity',
            expected: 38,
            actual: 37,
          }),
        ],
      }),
    );
  });
});
