import {
  getLimit,
  parseNullableString,
  parseRequiredNumber,
  parseSteelSourceRefs,
} from './types';
import { priceTierCodes, type PriceTierCode } from '../pricing/enums';

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
  customer_tier: string | null;
  status: string;
  source_refs: unknown;
}

export interface SteelCustomer extends SteelSourceBackedRecord {
  id: number;
  erpCustomerCode?: string;
  displayName: string;
  legalName?: string;
  taxId?: string;
  customerTier: PriceTierCode | null;
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

function parseCustomerTier(value: string | null): PriceTierCode | null {
  return priceTierCodes.find((tier) => tier === value) ?? null;
}

function toCustomer(row: SteelCustomerRow): SteelCustomer {
  return {
    id: parseRequiredNumber(row.id),
    erpCustomerCode: parseNullableString(row.erp_customer_code),
    displayName: row.display_name,
    legalName: parseNullableString(row.legal_name),
    taxId: parseNullableString(row.tax_id),
    customerTier: parseCustomerTier(row.customer_tier),
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
  c.customer_tier,
  c.status,
  c.source_refs
FROM steel.customers c
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
