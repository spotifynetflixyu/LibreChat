import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelWeightSpecRow {
  id: string | number;
  spec_key: string;
  product_family: string;
  shape: string;
  material_grade: string | null;
  thickness_mm: string | number | null;
  width_mm: string | number | null;
  height_mm: string | number | null;
  flange_width_mm: string | number | null;
  web_thickness_mm: string | number | null;
  length_m: string | number | null;
  weight_kg_per_m: string | number | null;
  weight_kg_per_piece: string | number | null;
  review_state: string;
  source_refs: unknown;
}

export interface SteelWeightSpec extends SteelSourceBackedRecord {
  id: number;
  specKey: string;
  productFamily: string;
  shape: string;
  materialGrade?: string;
  thicknessMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  flangeWidthMm: number | null;
  webThicknessMm: number | null;
  lengthM: number | null;
  weightKgPerM: number | null;
  weightKgPerPiece: number | null;
  reviewState: SteelReviewState;
  sourceRefs: SteelSourceRef[];
}

interface SearchSteelWeightSpecsInput {
  specKey?: string;
  productFamily?: string;
  shape?: string;
  reviewState?: SteelReviewState;
  limit?: number;
}

function toWeightSpec(row: SteelWeightSpecRow): SteelWeightSpec {
  return {
    id: parseRequiredNumber(row.id),
    specKey: row.spec_key,
    productFamily: row.product_family,
    shape: row.shape,
    materialGrade: parseNullableString(row.material_grade),
    thicknessMm: parseNullableNumber(row.thickness_mm),
    widthMm: parseNullableNumber(row.width_mm),
    heightMm: parseNullableNumber(row.height_mm),
    flangeWidthMm: parseNullableNumber(row.flange_width_mm),
    webThicknessMm: parseNullableNumber(row.web_thickness_mm),
    lengthM: parseNullableNumber(row.length_m),
    weightKgPerM: parseNullableNumber(row.weight_kg_per_m),
    weightKgPerPiece: parseNullableNumber(row.weight_kg_per_piece),
    reviewState: parseReviewState(row.review_state),
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelWeightSpecs(
  client: SteelRepositoryClient,
  input: SearchSteelWeightSpecsInput,
): Promise<SteelWeightSpec[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];

  if (input.specKey) {
    values.push(input.specKey);
    where.push(`spec_key = $${values.length}`);
  }
  if (input.productFamily) {
    values.push(input.productFamily);
    where.push(`product_family = $${values.length}`);
  }
  if (input.shape) {
    values.push(input.shape);
    where.push(`shape = $${values.length}`);
  }

  values.push(getLimit(input.limit));

  const result = await client.query<SteelWeightSpecRow>(
    `
SELECT
  id,
  spec_key,
  product_family,
  shape,
  material_grade,
  thickness_mm,
  width_mm,
  height_mm,
  flange_width_mm,
  web_thickness_mm,
  length_m,
  weight_kg_per_m,
  weight_kg_per_piece,
  review_state,
  source_refs
FROM steel.weight_specs
WHERE ${where.join('\n  AND ')}
ORDER BY spec_key ASC, id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toWeightSpec);
}
