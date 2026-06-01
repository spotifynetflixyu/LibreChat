import {
  parseJsonObject,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelJsonValue,
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
} from './types';

interface SteelFormulaVersionRow {
  id: string | number;
  code: string;
  version_seq: string | number;
  display_name: string | null;
  source_expression: string | null;
  formula_body: SteelJsonValue | null;
  compiled_formula: SteelJsonValue | null;
  allowed_variables: unknown;
  active: boolean;
  review_state: string;
  source_refs: unknown;
}

export interface SteelFormulaVersion extends SteelSourceBackedRecord {
  id: number;
  code: string;
  versionSeq: number;
  displayName?: string;
  sourceExpression?: string;
  formulaBody: SteelJsonValue;
  compiledFormula: SteelJsonValue;
  allowedVariables: string[];
  active: boolean;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

interface FindSteelFormulaVersionInput {
  code: string;
  reviewState?: SteelReviewState;
}

function parseAllowedVariables(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Steel formula allowed_variables must be an array');
  }

  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('Steel formula allowed variable must be a string');
    }

    return entry;
  });
}

function toFormula(row: SteelFormulaVersionRow): SteelFormulaVersion {
  return {
    id: parseRequiredNumber(row.id),
    code: row.code,
    versionSeq: parseRequiredNumber(row.version_seq),
    displayName: parseNullableString(row.display_name),
    sourceExpression: parseNullableString(row.source_expression),
    formulaBody: parseJsonObject(row.formula_body),
    compiledFormula: parseJsonObject(row.compiled_formula),
    allowedVariables: parseAllowedVariables(row.allowed_variables),
    active: row.active,
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function findSteelFormulaVersion(
  client: SteelRepositoryClient,
  input: FindSteelFormulaVersionInput,
): Promise<SteelFormulaVersion | null> {
  const result = await client.query<SteelFormulaVersionRow>(
    `
SELECT
  id,
  code,
  version_seq,
  display_name,
  source_expression,
  formula_body,
  compiled_formula,
  allowed_variables,
  active,
  review_state,
  source_refs
FROM steel.formula_versions
WHERE active = true
  AND review_state = $1
  AND code = $2
ORDER BY version_seq DESC, id DESC
LIMIT 1
`,
    [input.reviewState ?? 'reviewed', input.code],
  );

  return result.rows[0] ? toFormula(result.rows[0]) : null;
}
