import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseSteelSourceRefs,
} from './types';

import type {
  SteelRepositoryClient,
  SteelSourceBackedRecord,
  SteelSourceRef,
  SteelSqlParameter,
} from './types';

interface SteelCustomerRow {
  id: string | number;
  erp_customer_code: string | null;
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  customer_tier_id: string | number | null;
  customer_tier_code: string | null;
  customer_tier_name: string | null;
  matched_alias: string | null;
  status: string;
  source_refs: unknown;
}

export interface SteelCustomerTier {
  id: number;
  code: string;
  name: string;
}

export interface SteelCustomer extends SteelSourceBackedRecord {
  id: number;
  erpCustomerCode?: string;
  displayName: string;
  legalName?: string;
  taxId?: string;
  customerTier: SteelCustomerTier | null;
  matchedAlias?: string;
  status: string;
  sourceRefs: SteelSourceRef[];
}

export interface SearchSteelCustomersInput {
  keywords: readonly string[];
  limit?: number;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function toCustomer(row: SteelCustomerRow): SteelCustomer {
  const tierId = parseNullableNumber(row.customer_tier_id);
  const customerTier =
    tierId === null || !row.customer_tier_code || !row.customer_tier_name
      ? null
      : {
          id: tierId,
          code: row.customer_tier_code,
          name: row.customer_tier_name,
        };

  return {
    id: parseRequiredNumber(row.id),
    erpCustomerCode: parseNullableString(row.erp_customer_code),
    displayName: row.display_name,
    legalName: parseNullableString(row.legal_name),
    taxId: parseNullableString(row.tax_id),
    customerTier,
    matchedAlias: parseNullableString(row.matched_alias),
    status: row.status,
    sourceRefs: parseSteelSourceRefs(row.source_refs),
  };
}

export async function searchSteelCustomers(
  client: SteelRepositoryClient,
  input: SearchSteelCustomersInput,
): Promise<SteelCustomer[]> {
  const keywords = uniqueNonEmpty(input.keywords);
  const where: string[] = [];
  const values: SteelSqlParameter[] = [];
  const exactScoreExpressions: string[] = [];

  keywords.forEach((keyword) => {
    values.push(keyword, `%${keyword}%`);
    const exactPlaceholder = `$${values.length - 1}`;
    const containsPlaceholder = `$${values.length}`;
    exactScoreExpressions.push(`CASE WHEN c.erp_customer_code = ${exactPlaceholder} THEN 0 ELSE 1 END`);
    where.push(`(
      c.erp_customer_code = ${exactPlaceholder}
      OR c.display_name ILIKE ${containsPlaceholder}
      OR c.legal_name ILIKE ${containsPlaceholder}
      OR c.tax_id ILIKE ${containsPlaceholder}
      OR ca.alias ILIKE ${containsPlaceholder}
    )`);
  });

  const scoreExpression =
    exactScoreExpressions.length > 0 ? exactScoreExpressions.join(' + ') : '0';
  values.push(getLimit(input.limit));
  const whereClause = where.length > 0 ? `WHERE (${where.join('\n  OR ')})` : '';

  const result = await client.query<SteelCustomerRow>(
    `
SELECT
  c.id,
  c.erp_customer_code,
  c.display_name,
  c.legal_name,
  c.tax_id,
  c.customer_tier_id,
  ct.code AS customer_tier_code,
  ct.name AS customer_tier_name,
  ca.alias AS matched_alias,
  c.status,
  c.source_refs
FROM steel.customers c
LEFT JOIN steel.customer_tiers ct ON ct.id = c.customer_tier_id
LEFT JOIN steel.customer_aliases ca ON ca.customer_id = c.id
${whereClause}
ORDER BY
  ${scoreExpression},
  c.display_name ASC,
  c.id ASC
LIMIT $${values.length}
`,
    values,
  );

  return result.rows.map(toCustomer);
}
