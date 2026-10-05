import { createHash } from 'node:crypto';
import { steelCatalogOptionLabel } from 'librechat-data-provider';
import type {
  SteelCatalogCandidate,
  SteelCatalogPriceTier,
  SteelCatalogSearchField,
} from 'librechat-data-provider';
import type { SteelRepositoryClient, SteelSqlParameter } from './types';

export interface SearchSteelReviewCatalogInput {
  field: SteelCatalogSearchField;
  keyword: string;
  cursor?: SteelCatalogCursor;
  limit: number;
  tier: SteelCatalogPriceTier;
}

export interface ResolveSteelReviewCatalogCandidateInput {
  id: string;
  tier: SteelCatalogPriceTier;
}

export interface SteelCatalogCursor {
  field: SteelCatalogSearchField;
  keyword: string;
  scope: string;
  erpItemCode: string;
  id: string;
}

interface SteelCatalogRow {
  id: string;
  erp_item_code: string;
  product_name: string | null;
  spec_key: string;
  category: string;
  subcategory: string | null;
  formula_code: string | null;
  material: string | null;
  unit: string | null;
  cost_basis: string;
  value_state: string;
  unit_price_a: string | null;
  unit_price_b: string | null;
  unit_price_c: string | null;
  unit_price_d: string | null;
  unit_price_e: string | null;
  unit_price_f: string | null;
  unit_weight_value: string | null;
  unit_weight_basis: string | null;
  density: string | null;
  thickness_min_mm: string | null;
  thickness_max_mm: string | null;
  width_mm: string | null;
  height_mm: string | null;
  length_mm: string | null;
  outer_diameter_mm: string | null;
  web_mm: string | null;
  flange_mm: string | null;
  lip_mm: string | null;
  sheet_width_mm: string | null;
  sheet_length_mm: string | null;
  unit_price: string | null;
}

const catalogColumns = `
  p.id::text AS id,
  p.erp_item_code,
  p.product_name,
  p.spec_key,
  p.category,
  p.subcategory,
  p.formula_code,
  p.material,
  p.unit,
  p.cost_basis,
  p.value_state,
  p.unit_price_a::text AS unit_price_a,
  p.unit_price_b::text AS unit_price_b,
  p.unit_price_c::text AS unit_price_c,
  p.unit_price_d::text AS unit_price_d,
  p.unit_price_e::text AS unit_price_e,
  p.unit_price_f::text AS unit_price_f,
  p.unit_weight_value::text AS unit_weight_value,
  p.unit_weight_basis,
  p.density::text AS density,
  p.thickness_min_mm::text AS thickness_min_mm,
  p.thickness_max_mm::text AS thickness_max_mm,
  p.width_mm::text AS width_mm,
  p.height_mm::text AS height_mm,
  p.length_mm::text AS length_mm,
  p.outer_diameter_mm::text AS outer_diameter_mm,
  p.web_mm::text AS web_mm,
  p.flange_mm::text AS flange_mm,
  p.lip_mm::text AS lip_mm,
  p.sheet_width_mm::text AS sheet_width_mm,
  p.sheet_length_mm::text AS sheet_length_mm,
  CASE $1::text
    WHEN 'A' THEN p.unit_price_a::text
    WHEN 'B' THEN p.unit_price_b::text
    WHEN 'C' THEN p.unit_price_c::text
    WHEN 'D' THEN p.unit_price_d::text
    WHEN 'E' THEN p.unit_price_e::text
    WHEN 'F' THEN p.unit_price_f::text
  END AS unit_price
`;

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function candidateRevision(row: SteelCatalogRow): string {
  return createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

function toCandidate(row: SteelCatalogRow): SteelCatalogCandidate {
  const revision = candidateRevision(row);
  const exactPhysical = {
    ...(row.density ? { density: row.density } : {}),
    ...(row.width_mm ? { widthMm: row.width_mm } : {}),
    ...(row.length_mm ? { lengthMm: row.length_mm } : {}),
    ...(row.unit_weight_value ? { unitWeightValue: row.unit_weight_value } : {}),
  };
  return {
    id: row.id,
    revision,
    erpItemCode: row.erp_item_code,
    productName: row.product_name,
    specKey: row.spec_key,
    category: row.category,
    subcategory: row.subcategory,
    formulaCode: row.formula_code,
    material: row.material,
    unit: row.unit,
    costBasis: row.cost_basis,
    valueState: row.value_state,
    unitWeightValue: row.unit_weight_value,
    unitWeightBasis: row.unit_weight_basis,
    density: row.density,
    thicknessMinMm: row.thickness_min_mm,
    thicknessMaxMm: row.thickness_max_mm,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    lengthMm: row.length_mm,
    outerDiameterMm: row.outer_diameter_mm,
    webMm: row.web_mm,
    flangeMm: row.flange_mm,
    lipMm: row.lip_mm,
    sheetWidthMm: row.sheet_width_mm,
    sheetLengthMm: row.sheet_length_mm,
    unitPrice: row.unit_price,
    calculation: {
      erpItemCode: row.erp_item_code,
      category: row.category,
      ruleVersion: 'steel-catalog-v1',
      ...(row.unit_weight_basis ? { unitWeightBasis: row.unit_weight_basis } : {}),
      exactPhysical,
    },
    label: steelCatalogOptionLabel({ erpItemCode: row.erp_item_code, productName: row.product_name, specKey: row.spec_key }),
  };
}

function searchWhere(input: SearchSteelReviewCatalogInput, cursor: SteelCatalogCursor | undefined): {
  sql: string;
  values: SteelSqlParameter[];
} {
  const values: SteelSqlParameter[] = [input.tier];
  const keyword = escapeLikeLiteral(input.keyword.normalize('NFKC').trim().toLocaleLowerCase());
  values.push(keyword);
  const predicates = [
    `p.category NOT LIKE '加工/%'`,
  ];
  if (keyword) {
    predicates.push(input.field === 'model'
      ? `lower(p.erp_item_code) COLLATE "C" LIKE $2 COLLATE "C" || '%' ESCAPE '\\'`
      : `(lower(COALESCE(p.product_name, '')) LIKE '%' || $2 || '%' ESCAPE '\\'
          OR lower(p.spec_key) LIKE '%' || $2 || '%' ESCAPE '\\')`);
  }
  if (cursor) {
    values.push(cursor.erpItemCode, cursor.id);
    predicates.push(`(
      lower(p.erp_item_code) COLLATE "C" > lower($${values.length - 1}) COLLATE "C"
      OR (
        lower(p.erp_item_code) COLLATE "C" = lower($${values.length - 1}) COLLATE "C"
        AND p.id::text COLLATE "C" > $${values.length} COLLATE "C"
      )
    )`);
  }
  return { sql: predicates.join('\n  AND '), values };
}

function querySql(input: SearchSteelReviewCatalogInput, cursor: SteelCatalogCursor | undefined): {
  sql: string;
  values: SteelSqlParameter[];
} {
  const where = searchWhere(input, cursor);
  const limitPlaceholder = where.values.length + 1;
  where.values.push(input.limit + 1);
  return {
    sql: `
SELECT ${catalogColumns}
FROM steel.prices AS p
WHERE ${where.sql}
ORDER BY lower(p.erp_item_code) COLLATE "C" ASC, p.id::text COLLATE "C" ASC
LIMIT $${limitPlaceholder}
`,
    values: where.values,
  };
}

export async function searchSteelReviewCatalog(
  client: SteelRepositoryClient,
  input: SearchSteelReviewCatalogInput,
): Promise<{ candidates: SteelCatalogCandidate[]; hasMore: boolean }> {
  const { sql, values } = querySql(input, input.cursor);
  const result = await client.query<SteelCatalogRow>(sql, values);
  const rows = result.rows;
  const hasMore = rows.length > input.limit;
  return {
    candidates: rows.slice(0, input.limit).map(toCandidate),
    hasMore,
  };
}

export async function resolveSteelReviewCatalogCandidate(
  client: SteelRepositoryClient,
  input: ResolveSteelReviewCatalogCandidateInput,
): Promise<SteelCatalogCandidate | null> {
  const result = await client.query<SteelCatalogRow>(
    `SELECT ${catalogColumns}
FROM steel.prices AS p
WHERE p.id::text = $2
  AND p.category NOT LIKE '加工/%'
LIMIT 1`,
    [input.tier, input.id],
  );
  const row = result.rows[0];
  return row ? toCandidate(row) : null;
}

export function encodeSteelCatalogCursor(cursor: SteelCatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSteelCatalogCursor(value: string): SteelCatalogCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<SteelCatalogCursor>;
    if ((candidate.field !== 'model' && candidate.field !== 'description') ||
      typeof candidate.keyword !== 'string' || typeof candidate.scope !== 'string' ||
      typeof candidate.erpItemCode !== 'string' || typeof candidate.id !== 'string' ||
      !candidate.erpItemCode || !candidate.id) return null;
    return candidate as SteelCatalogCursor;
  } catch {
    return null;
  }
}
