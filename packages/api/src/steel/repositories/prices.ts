import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseReviewState,
  parseSteelSourceRefs,
  parseValueState,
} from './types';

import type {
  SteelRepositoryClient,
  SteelReviewState,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
  SteelValueState,
} from './types';

interface SteelPriceItemRow {
  id: string | number;
  erp_item_code: string | null;
  category_id: string | number | null;
  customer_tier_id: string | number | null;
  spec_key: string;
  product_name: string;
  material_grade: string | null;
  unit: string;
  unit_price: string | number | null;
  product_price_unit_weight: string | number | null;
  product_price_unit_weight_unit: string | null;
  currency: string;
  value_state: string;
  review_state: string;
  active: boolean;
  source_refs: unknown;
}

export interface SteelPriceItem extends SteelSourceBackedRecord {
  id: number;
  erpItemCode?: string;
  categoryId: number | null;
  customerTierId: number | null;
  specKey: string;
  productName: string;
  materialGrade?: string;
  unit: string;
  unitPrice: number | null;
  productPriceUnitWeight: number | null;
  productPriceUnitWeightUnit?: string;
  currency: string;
  valueState: SteelValueState;
  reviewState: SteelReviewState;
  active: boolean;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelPriceItemsInput {
  specKey?: string;
  specKeyContains?: string;
  productName?: string;
  customerTierId?: number;
  reviewState?: SteelReviewState;
  includeInactive?: boolean;
  limit?: number;
}

function toPriceItem(row: SteelPriceItemRow): SteelPriceItem {
  return {
    id: parseRequiredNumber(row.id),
    erpItemCode: parseNullableString(row.erp_item_code),
    categoryId: parseNullableNumber(row.category_id),
    customerTierId: parseNullableNumber(row.customer_tier_id),
    specKey: row.spec_key,
    productName: row.product_name,
    materialGrade: parseNullableString(row.material_grade),
    unit: row.unit,
    unitPrice: parseNullableNumber(row.unit_price),
    productPriceUnitWeight: parseNullableNumber(row.product_price_unit_weight),
    productPriceUnitWeightUnit: parseNullableString(row.product_price_unit_weight_unit),
    currency: row.currency,
    valueState: parseValueState(row.value_state),
    reviewState: parseReviewState(row.review_state),
    active: row.active,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelPriceItems(
  client: SteelRepositoryClient,
  input: SearchSteelPriceItemsInput,
): Promise<SteelPriceItem[]> {
  const where = ['review_state = $1'];
  const values: SteelSqlParameter[] = [input.reviewState ?? 'reviewed'];

  if (!input.includeInactive) {
    where.push('active = true');
  }

  if (input.specKey) {
    values.push(input.specKey);
    where.push(`spec_key = $${values.length}`);
  }

  if (input.specKeyContains) {
    values.push(`%${input.specKeyContains}%`);
    where.push(`spec_key ILIKE $${values.length}`);
  }

  if (input.productName) {
    values.push(`%${input.productName}%`);
    where.push(`product_name ILIKE $${values.length}`);
  }

  if (input.customerTierId !== undefined) {
    values.push(input.customerTierId);
    where.push(`(customer_tier_id = $${values.length} OR customer_tier_id IS NULL)`);
  }

  values.push(getLimit(input.limit));

  const result = await client.query<SteelPriceItemRow>(
    `
SELECT
  id,
  erp_item_code,
  category_id,
  customer_tier_id,
  spec_key,
  product_name,
  material_grade,
  unit,
  unit_price,
  product_price_unit_weight,
  product_price_unit_weight_unit,
  currency,
  value_state,
  review_state,
  active,
  source_refs
FROM steel.price_items
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE WHEN customer_tier_id IS NULL THEN 1 ELSE 0 END,
  product_name ASC,
  id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toPriceItem);
}
