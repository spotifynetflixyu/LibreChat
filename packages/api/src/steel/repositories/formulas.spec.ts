import { findSteelFormulaVersion } from './formulas';

import type { SteelRepositoryClient } from './types';

describe('Steel formula repository', () => {
  it('finds an active reviewed formula version by code', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '7',
          code: 'F001',
          version_seq: 2,
          display_name: '重量公式',
          source_expression: '長度 * 單重',
          formula_body: { legacy: true },
          compiled_formula: { op: 'multiply', args: ['length_m', 'weight_kg_per_m'] },
          allowed_variables: ['length_m', 'weight_kg_per_m'],
          active: true,
          review_state: 'reviewed',
          source_refs: [],
        },
      ],
    });

    const result = await findSteelFormulaVersion({ query } as SteelRepositoryClient, {
      code: 'F001',
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('code = $2'), ['reviewed', 'F001']);
    expect(result).toMatchObject({
      id: 7,
      code: 'F001',
      versionSeq: 2,
      compiledFormula: { op: 'multiply', args: ['length_m', 'weight_kg_per_m'] },
      allowedVariables: ['length_m', 'weight_kg_per_m'],
    });
  });
});
