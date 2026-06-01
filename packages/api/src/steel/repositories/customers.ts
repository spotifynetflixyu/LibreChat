import {
  getLimit,
  parseNullableNumber,
  parseNullableString,
  parseRequiredNumber,
  parseSteelSourceRefs,
} from './types';

import type { SteelRepositoryClient, SteelSourceBackedRecord, SteelSourceRef } from './types';

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

interface SearchSteelCustomersInput {
  searchText: string;
  includeInactive?: boolean;
  limit?: number;
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
  const where = [
    `(
      c.erp_customer_code = $1
      OR c.display_name ILIKE $2
      OR c.legal_name ILIKE $2
      OR ca.alias ILIKE $2
    )`,
  ];

  if (!input.includeInactive) {
    where.push(`c.status = 'active'`);
  }

  const values = [input.searchText, `%${input.searchText}%`, getLimit(input.limit)];

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
WHERE ${where.join('\n  AND ')}
ORDER BY
  CASE
    WHEN c.erp_customer_code = $1 THEN 0
    WHEN c.display_name = $1 THEN 1
    WHEN ca.alias = $1 THEN 2
    ELSE 3
  END,
  c.display_name ASC,
  c.id ASC
LIMIT $3
`,
    values,
  );

  return result.rows.map(toCustomer);
}
